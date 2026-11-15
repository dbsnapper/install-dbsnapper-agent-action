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
import { AddressInfo, Socket } from 'net'
import os from 'os'
import path from 'path'
import { DownloadError, downloadFile } from '../src/download'

// Port 0 lets the kernel choose; set this to stay inside a reserved block
const PORT = Number(process.env['INSTALL_ACTION_TEST_PORT'] ?? 0)
const BODY = 'made-up archive bytes'

let server: http.Server
let closed: Promise<unknown[]>[]
let requests: number
let tmpDir: string

// Starts a server that answers every request with `handler`
async function serve(
  handler: (res: http.ServerResponse) => void
): Promise<string> {
  requests = 0
  closed = []
  server = http.createServer((_req, res) => {
    requests++
    handler(res)
  })
  server.on('connection', (socket: Socket) => {
    closed.push(once(socket, 'close'))
  })
  server.listen(PORT, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`
}

describe('download.ts', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(core, 'info').mockImplementation()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-action-dl-'))
    process.env['RUNNER_TEMP'] = tmpDir
  })

  afterEach(async () => {
    server.closeAllConnections()
    server.close()
    await once(server, 'close')
    delete process.env['RUNNER_TEMP']
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
})
