import { expect, test } from '@jest/globals'
import * as httpm from '@actions/http-client'
import { once } from 'events'
import http from 'http'
import net, { AddressInfo, Socket } from 'net'
import os from 'os'
import { Readable } from 'stream'
import { resolveRelease } from '../src/util'

const LATEST_URL =
  'https://api.github.com/repos/dbsnapper/dbsnapper/releases/latest'

// Answers the latest-release lookup with `status` and `body`, without network.
function answerLookup(status: number, body: string): jest.SpyInstance {
  const message = Object.assign(Readable.from([Buffer.from(body)]), {
    statusCode: status,
    complete: true
  })
  return jest
    .spyOn(httpm.HttpClient.prototype, 'get')
    .mockResolvedValue({ message } as unknown as httpm.HttpClientResponse)
}

// Port 0 lets the kernel choose; set this to stay inside a reserved block.
// +1: download.test.ts, which may run at the same time, uses the port itself.
const BASE_PORT = Number(process.env['INSTALL_ACTION_TEST_PORT'] ?? 0)
const PORT = BASE_PORT ? BASE_PORT + 1 : 0
const PROXY_VARS = [
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY'
]
// The full answer GitHub would send: several kB, so it spans several packets
const FULL_ANSWER = JSON.stringify({
  tag_name: 'v2.9.0',
  pad: 'x'.repeat(20000)
})

let server: net.Server | undefined
let sockets: Socket[] = []
let connections = 0
const savedEnv: Record<string, string | undefined> = {}

async function listen(s: net.Server): Promise<number> {
  server = s
  server.on('connection', (socket: Socket) => {
    connections++
    sockets.push(socket)
  })
  server.listen(PORT, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as AddressInfo).port
}

// Sends the lookup to a local server answering with `handler`, through
// http-client's real request and response code
async function lookupAgainst(
  handler: (res: http.ServerResponse) => void
): Promise<void> {
  const port = await listen(http.createServer((_req, res) => handler(res)))
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with the lookup's client as `this`
  const realGet = httpm.HttpClient.prototype.get
  jest
    .spyOn(httpm.HttpClient.prototype, 'get')
    .mockImplementation(async function (this: httpm.HttpClient, _url, headers) {
      // eslint-disable-next-line no-invalid-this -- the client the lookup created
      return realGet.call(this, `http://127.0.0.1:${port}/latest`, headers)
    })
}

describe('util.ts', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(os, 'platform').mockReturnValue('linux')
    jest.spyOn(os, 'arch').mockReturnValue('x64')
    // No proxy unless a test sets one
    for (const name of PROXY_VARS) {
      savedEnv[name] = process.env[name]
      delete process.env[name]
    }
  })

  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    sockets = []
    connections = 0
    if (server) {
      server.close()
      await once(server, 'close')
      server = undefined
    }
    for (const name of PROXY_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name]
      else process.env[name] = savedEnv[name]
    }
  })

  test.each(['2.7.2', 'v2.7.2'])(
    'pinned version %s resolves to that release without asking GitHub',
    async version => {
      const get = jest.spyOn(httpm.HttpClient.prototype, 'get')
      await expect(resolveRelease(version, 'workflow-token')).resolves.toEqual({
        tag: 'v2.7.2',
        archiveName: 'dbsnapper_2.7.2_linux_amd64.tar.gz',
        archiveUrl:
          'https://github.com/dbsnapper/dbsnapper/releases/download/v2.7.2/dbsnapper_2.7.2_linux_amd64.tar.gz',
        checksumsUrl:
          'https://github.com/dbsnapper/dbsnapper/releases/download/v2.7.2/checksums.txt'
      })
      expect(get).not.toHaveBeenCalled()
    }
  )

  test.each(['2.9', 'v2.9.0/../../x', '2.9.0 ', 'main', '../2.9.0'])(
    'a version that is not a version number (%s) is refused before any download',
    async version => {
      const get = jest.spyOn(httpm.HttpClient.prototype, 'get')
      await expect(resolveRelease(version)).rejects.toThrow(
        `Invalid version "${version}"`
      )
      expect(get).not.toHaveBeenCalled()
    }
  )

  test('latest resolves to the tag GitHub answers and sends the token to api.github.com', async () => {
    const get = answerLookup(200, JSON.stringify({ tag_name: 'v2.9.0' }))

    await expect(resolveRelease('latest', 'workflow-token')).resolves.toEqual(
      expect.objectContaining({
        tag: 'v2.9.0',
        archiveName: 'dbsnapper_2.9.0_linux_amd64.tar.gz'
      })
    )
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(LATEST_URL, {
      authorization: 'Bearer workflow-token'
    })
  })

  test('latest without a token asks GitHub anonymously', async () => {
    const get = answerLookup(200, JSON.stringify({ tag_name: 'v2.9.0' }))

    await expect(resolveRelease('')).resolves.toEqual(
      expect.objectContaining({ tag: 'v2.9.0' })
    )
    expect(get).toHaveBeenCalledWith(LATEST_URL, {})
  })

  test.each([403, 429])(
    'a refused lookup (HTTP %d) names the GitHub rate limit and pinning a version',
    async status => {
      answerLookup(status, '{"message":"API rate limit exceeded"}')

      const lookup = resolveRelease('latest')
      await expect(lookup).rejects.toThrow(
        `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL} answered HTTP ${status}`
      )
      await expect(lookup).rejects.toThrow('GitHub rate limit')
      await expect(lookup).rejects.toThrow('Pin a version')
    }
  )

  test('a refused token (HTTP 401) says so and names pinning a version or a valid token', async () => {
    answerLookup(401, '{"message":"Bad credentials"}')

    const lookup = resolveRelease('latest', 'expired-token')
    await expect(lookup).rejects.toThrow(
      `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL} answered HTTP 401: GitHub refused the token`
    )
    await expect(lookup).rejects.toThrow('Pin a version')
    await expect(lookup).rejects.toThrow('pass a valid token')
  })

  test.each(['release-3', 'vv2.9.0', '../x', 'v2.9.0/../../x', 'v2.9.0?x'])(
    'a latest tag that is not a version number (%s) is refused like the version input',
    async tag => {
      answerLookup(200, JSON.stringify({ tag_name: tag }))

      await expect(resolveRelease('latest')).rejects.toThrow(
        `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL} returned the tag ${JSON.stringify(tag)}, which is not a version number`
      )
    }
  )

  test('a JSON null answer fails with the lookup prefix', async () => {
    answerLookup(200, 'null')

    await expect(resolveRelease('latest')).rejects.toThrow(
      `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL} returned no tag`
    )
  })

  test('a network error during the lookup says which lookup failed', async () => {
    jest
      .spyOn(httpm.HttpClient.prototype, 'get')
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'))

    await expect(resolveRelease('latest')).rejects.toThrow(
      `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL}: getaddrinfo ENOTFOUND api.github.com`
    )
  })

  test.each([
    ['destroys', (socket: Socket): unknown => socket.destroy()],
    ['closes', (socket: Socket): unknown => socket.end()]
  ])(
    'a connection the server %s in the middle of the answer fails the lookup with its prefix',
    async (_, cut) => {
      await lookupAgainst(res => {
        res.writeHead(200, { 'content-length': String(FULL_ANSWER.length) })
        res.write(FULL_ANSWER.slice(0, 100))
        // Real time on purpose: the client must have the headers and the
        // first bytes before the cut, and a reset sent at once can overtake
        // them; the server cannot observe the client's read
        setTimeout(() => cut(res.socket as Socket), 50)
      })

      await expect(
        resolveRelease('latest', undefined, { stallSeconds: 5 })
      ).rejects.toThrow(
        `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL}: the connection closed before the whole answer arrived`
      )
    }
  )

  test('the lookup reads an answer of several packets over a real connection', async () => {
    await lookupAgainst(res => {
      res.writeHead(200, { 'content-length': String(FULL_ANSWER.length) })
      res.end(FULL_ANSWER)
    })

    await expect(resolveRelease('latest')).resolves.toEqual(
      expect.objectContaining({ tag: 'v2.9.0' })
    )
  })

  test.each([
    ['before the answer', (): void => {}],
    [
      'in the middle of the answer',
      (res: http.ServerResponse): void => {
        res.writeHead(200, { 'content-length': String(FULL_ANSWER.length) })
        res.write(FULL_ANSWER.slice(0, 100))
      }
    ]
  ])(
    'a server that stops sending %s fails the lookup at the stall limit',
    async (_, handler) => {
      await lookupAgainst(handler)
      const started = Date.now()

      await expect(
        resolveRelease('latest', undefined, { stallSeconds: 0.3 })
      ).rejects.toThrow(
        `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL}: the answer stalled: no data for 0.3 seconds`
      )
      expect(Date.now() - started).toBeLessThan(3000)
    }
  )

  test('behind a proxy that accepts the connection and never answers CONNECT, the lookup fails at the stall limit', async () => {
    // Reads the CONNECT request, never answers it
    const port = await listen(net.createServer())
    process.env['https_proxy'] = `http://127.0.0.1:${port}`
    const started = Date.now()

    await expect(
      resolveRelease('latest', undefined, { stallSeconds: 0.3 })
    ).rejects.toThrow(
      `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL}: the answer stalled: no data for 0.3 seconds`
    )
    expect(Date.now() - started).toBeLessThan(3000)
    // The lookup went to the proxy, not to api.github.com
    expect(connections).toBe(1)
  })
})
