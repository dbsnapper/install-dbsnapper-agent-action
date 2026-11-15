import * as core from '@actions/core'
import * as httpm from '@actions/http-client'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Transform } from 'stream'
import { pipeline } from 'stream/promises'
import { setTimeout as sleep } from 'timers/promises'

const USER_AGENT = 'dbsnapper-install-gh-action'

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly httpStatusCode?: number
  ) {
    super(message)
    this.name = 'DownloadError'
  }
}

export interface DownloadOptions {
  // No data for this long aborts the attempt
  stallSeconds?: number
  attempts?: number
  retryWaitSeconds?: number
}

// Like tool-cache: client errors other than 408 and 429 are final
function isRetryable(error: unknown): boolean {
  const status = error instanceof DownloadError ? error.httpStatusCode : 0
  return !status || status >= 500 || status === 408 || status === 429
}

/**
 * Downloads `url` to a new file under RUNNER_TEMP and returns its path. An
 * attempt that receives no data for `stallSeconds` is aborted (its connection
 * destroyed, so nothing keeps the step running); failed attempts are retried
 * like tool-cache's downloadTool. Throws DownloadError for an HTTP status
 * other than 200 and for a stall.
 */
export async function downloadFile(
  url: string,
  {
    stallSeconds = 30,
    attempts = 3,
    retryWaitSeconds = 10
  }: DownloadOptions = {}
): Promise<string> {
  const dir = process.env['RUNNER_TEMP'] || os.tmpdir()
  const dest = path.join(dir, crypto.randomUUID())
  for (let attempt = 1; ; attempt++) {
    try {
      await downloadOnce(url, dest, stallSeconds)
      return dest
    } catch (error) {
      await fs.promises.rm(dest, { force: true })
      const message = error instanceof Error ? error.message : `${error}`
      if (!isRetryable(error)) throw error
      if (attempt >= attempts) {
        throw new DownloadError(
          attempts > 1 ? `${message} (${attempts} attempts)` : message,
          error instanceof DownloadError ? error.httpStatusCode : undefined
        )
      }
      core.info(
        `Downloading ${url} failed: ${message}; trying again in ${retryWaitSeconds} seconds`
      )
      await sleep(retryWaitSeconds * 1000)
    }
  }
}

async function downloadOnce(
  url: string,
  dest: string,
  stallSeconds: number
): Promise<void> {
  const client = new httpm.HttpClient(USER_AGENT, [], {
    allowRetries: false,
    // http-client's own timeout ends the socket without destroying it; ours
    // fires first and destroys it. This one is the backstop behind a proxy.
    socketTimeout: (stallSeconds + 5) * 1000
  })
  let response: httpm.HttpClientResponse | undefined
  let stalled = false
  // Restarted by every chunk received (refresh)
  const timer = setTimeout(() => {
    stalled = true
    // Destroys the connections of a direct request, waiting or mid-body
    client.dispose()
    response?.message.destroy()
  }, stallSeconds * 1000)
  try {
    response = await client.get(url)
    const status = response.message.statusCode
    if (status !== 200) {
      throw new DownloadError(`HTTP ${status}`, status)
    }
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        timer.refresh()
        callback(null, chunk)
      }
    })
    await pipeline(response.message, progress, fs.createWriteStream(dest))
  } catch (error) {
    if (stalled) {
      throw new DownloadError(
        `download stalled: no data for ${stallSeconds} seconds`
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
    response?.message.destroy()
    client.dispose()
  }
}
