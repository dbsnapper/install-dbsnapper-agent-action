/**
 * Unit tests for src/download.ts against a local HTTP server on loopback.
 *
 * The stall tests use real time on purpose: the watchdog guards real sockets,
 * which fake timers do not drive. A 0.3 s stall limit keeps them short.
 */

import { expect, test } from '@jest/globals'
import * as core from '@actions/core'
import { once } from 'events'
import fs from 'fs'
import http from 'http'
import net, { AddressInfo, Socket } from 'net'
import os from 'os'
import path from 'path'
import { DownloadError, downloadFile } from '../src/download'

// Port 0 lets the kernel choose; set this to stay inside a reserved block
const PORT = Number(process.env['INSTALL_ACTION_TEST_PORT'] ?? 0)
const BODY = 'made-up archive bytes'

let server: net.Server
let sockets: Socket[]
let closed: Promise<unknown[]>[]
let requests: number
let tmpDir: string
const PROXY_VARS = [
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY'
]
const savedEnv: Record<string, string | undefined> = {}

async function listen(s: net.Server): Promise<number> {
  server = s
  requests = 0
  sockets = []
  closed = []
  server.on('connection', (socket: Socket) => {
    sockets.push(socket)
    closed.push(once(socket, 'close'))
  })
  server.listen(PORT, '127.0.0.1')
  await once(server, 'listening')
  return (server.address() as AddressInfo).port
}

// Starts a server that answers every request with `handler`
async function serve(
  handler: (res: http.ServerResponse) => void
): Promise<string> {
  const port = await listen(
    http.createServer((_req, res) => {
      requests++
      handler(res)
    })
  )
  return `http://127.0.0.1:${port}/file`
}

// Starts a proxy that accepts every connection, reads the CONNECT request and
// never answers it; returns its address. `requests` counts its connections.
async function silentProxy(): Promise<string> {
  const port = await listen(net.createServer(() => requests++))
  return `http://127.0.0.1:${port}`
}

describe('download.ts', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(core, 'info').mockImplementation()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-action-dl-'))
    process.env['RUNNER_TEMP'] = tmpDir
    // No proxy unless a test sets one
    for (const name of PROXY_VARS) {
      savedEnv[name] = process.env[name]
      delete process.env[name]
    }
  })

  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    server.close()
    await once(server, 'close')
    delete process.env['RUNNER_TEMP']
    for (const name of PROXY_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name]
      else process.env[name] = savedEnv[name]
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('downloads the file into RUNNER_TEMP', async () => {
    const url = await serve(res => res.end(BODY))

    const file = await downloadFile(url, { stallSeconds: 2 })

    expect(path.dirname(file)).toBe(tmpDir)
    expect(fs.readFileSync(file, 'utf8')).toBe(BODY)
  })

  test.each([
    [
      'before the answer',
      // accepts the request and never answers
      (): void => {}
    ],
    [
      'in the middle of the file',
      (res: http.ServerResponse): void => {
        res.writeHead(200, { 'content-length': String(BODY.length) })
        res.write(BODY.slice(0, 5))
      }
    ],
    [
      'in the middle of a redirect answer',
      // http-client reads a redirect's body itself, and never settles when
      // that body stops: only the watchdog can end the attempt
      (res: http.ServerResponse): void => {
        res.writeHead(302, {
          location: 'http://127.0.0.1:1/never-reached',
          'content-length': String(BODY.length)
        })
        res.write(BODY.slice(0, 5))
      }
    ]
  ])(
    'a server that stops sending %s fails the download promptly and leaves no connection open',
    async (_, handler) => {
      const url = await serve(handler)
      const started = Date.now()

      const download = downloadFile(url, {
        stallSeconds: 0.3,
        attempts: 2,
        retryWaitSeconds: 0
      })

      await expect(download).rejects.toThrow(
        new DownloadError(
          'download stalled: no data for 0.3 seconds (2 attempts)'
        )
      )
      expect(Date.now() - started).toBeLessThan(3000)
      expect(requests).toBe(2)
      // Aborted, not half-closed: every connection closes (or the test times
      // out), so nothing is left to keep the step running
      await Promise.all(closed)
      expect(fs.readdirSync(tmpDir)).toEqual([])
    }
  )

  test('an HTTP 404 fails at once with its status', async () => {
    const url = await serve(res => {
      res.statusCode = 404
      res.end('Not Found')
    })

    const download = downloadFile(url, { retryWaitSeconds: 0 })

    await expect(download).rejects.toMatchObject({ httpStatusCode: 404 })
    expect(requests).toBe(1)
  })

  test('behind a proxy that accepts the connection and never answers CONNECT, each attempt ends at the stall limit', async () => {
    const proxy = await silentProxy()
    process.env['http_proxy'] = proxy
    const started = Date.now()

    // Never resolved: every request goes to the proxy
    const download = downloadFile('http://fake.test/file', {
      stallSeconds: 0.3,
      attempts: 2,
      retryWaitSeconds: 0
    })

    await expect(download).rejects.toThrow(
      new DownloadError(
        'download stalled: no data for 0.3 seconds (2 attempts)'
      )
    )
    expect(Date.now() - started).toBeLessThan(3000)
    expect(requests).toBe(2)
    expect(fs.readdirSync(tmpDir)).toEqual([])
  })
})
