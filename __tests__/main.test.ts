/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as httpm from '@actions/http-client'
import * as tc from '@actions/tool-cache'
import * as download from '../src/download'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as main from '../src/main'

const ARCHIVE_NAME = 'dbsnapper_2.9.0_linux_amd64.tar.gz'
const ARCHIVE_URL = `https://github.com/dbsnapper/dbsnapper/releases/download/v2.9.0/${ARCHIVE_NAME}`
const CHECKSUMS_URL =
  'https://github.com/dbsnapper/dbsnapper/releases/download/v2.9.0/checksums.txt'
const ARCHIVE_BYTES = 'made-up agent archive bytes'
const ARCHIVE_SHA256 = crypto
  .createHash('sha256')
  .update(ARCHIVE_BYTES)
  .digest('hex')

let tmpDir: string
let archivePath: string
let setFailedMock: jest.SpyInstance
let downloadMock: jest.SpyInstance
let setSecretMock: jest.SpyInstance
let extractTarMock: jest.SpyInstance
let addPathMock: jest.SpyInstance

function useInput(version: string, token = 'workflow-token'): void {
  const inputs: Record<string, string> = { version, token }
  jest
    .spyOn(core, 'getInput')
    .mockImplementation((name: string) => inputs[name] ?? '')
}

// Serves the archive and, unless `checksums` is undefined, a checksums file
// with the given content; a missing checksums file answers HTTP 404.
function serveRelease(checksums: string | undefined): void {
  const checksumsPath = path.join(tmpDir, 'checksums.txt')
  if (checksums !== undefined) {
    fs.writeFileSync(checksumsPath, checksums)
  }
  downloadMock.mockImplementation(async (url: string) => {
    if (url === ARCHIVE_URL) return archivePath
    if (url === CHECKSUMS_URL && checksums !== undefined) return checksumsPath
    throw new download.DownloadError('HTTP 404', 404)
  })
}

describe('action', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-action-test-'))
    archivePath = path.join(tmpDir, 'archive')
    fs.writeFileSync(archivePath, ARCHIVE_BYTES)

    jest.spyOn(os, 'platform').mockReturnValue('linux')
    jest.spyOn(os, 'arch').mockReturnValue('x64')
    jest.spyOn(core, 'info').mockImplementation()
    setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
    addPathMock = jest.spyOn(core, 'addPath').mockImplementation()
    setSecretMock = jest.spyOn(core, 'setSecret').mockImplementation()
    downloadMock = jest.spyOn(download, 'downloadFile')
    extractTarMock = jest
      .spyOn(tc, 'extractTar')
      .mockResolvedValue('/path/to/agent')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('installs a pinned version whose archive matches the published checksum', async () => {
    useInput('v2.9.0')
    serveRelease(
      `${'0'.repeat(64)}  dbsnapper_2.9.0_darwin_all.zip\n${ARCHIVE_SHA256}  ${ARCHIVE_NAME}\n`
    )

    await main.run()

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(extractTarMock).toHaveBeenCalledWith(archivePath)
    expect(addPathMock).toHaveBeenCalledWith('/path/to/agent')
    // The token goes only to api.github.com, never with release downloads
    expect(downloadMock.mock.calls).toEqual([[ARCHIVE_URL], [CHECKSUMS_URL]])
  })

  test.each([
    ['a token', 'literal-token', [['literal-token']]],
    ['no token', '', []]
  ])('masks the token in the log when given (%s)', async (_, token, calls) => {
    useInput('v2.9.0', token)
    serveRelease(`${ARCHIVE_SHA256}  ${ARCHIVE_NAME}\n`)

    await main.run()

    expect(setSecretMock.mock.calls).toEqual(calls)
    expect(setFailedMock).not.toHaveBeenCalled()
  })

  it('names the archive and the stall when its download stalls', async () => {
    useInput('v2.9.0')
    downloadMock.mockRejectedValue(
      new download.DownloadError(
        'download stalled: no data for 30 seconds (3 attempts)'
      )
    )

    await main.run()

    expect(setFailedMock).toHaveBeenCalledWith(
      `Failed to download ${ARCHIVE_NAME} from ${ARCHIVE_URL}: download stalled: no data for 30 seconds (3 attempts)`
    )
    expect(extractTarMock).not.toHaveBeenCalled()
    expect(addPathMock).not.toHaveBeenCalled()
  })

  it('fails without unpacking when the archive does not match its checksum', async () => {
    useInput('v2.9.0')
    serveRelease(`${'a'.repeat(64)}  ${ARCHIVE_NAME}\n`)

    await main.run()

    expect(setFailedMock).toHaveBeenCalledWith(
      expect.stringContaining(`Checksum mismatch for ${ARCHIVE_NAME}`)
    )
    expect(extractTarMock).not.toHaveBeenCalled()
    expect(addPathMock).not.toHaveBeenCalled()
  })

  it('fails without unpacking when the release has no checksums file', async () => {
    useInput('v2.9.0')
    serveRelease(undefined)

    await main.run()

    expect(setFailedMock).toHaveBeenCalledWith(
      expect.stringContaining('the release publishes no checksums file')
    )
    expect(extractTarMock).not.toHaveBeenCalled()
    expect(addPathMock).not.toHaveBeenCalled()
  })

  it('fails without unpacking when the checksums file does not list the archive', async () => {
    useInput('v2.9.0')
    serveRelease(`${ARCHIVE_SHA256}  dbsnapper_2.9.0_linux_arm64.tar.gz\n`)

    await main.run()

    expect(setFailedMock).toHaveBeenCalledWith(
      expect.stringContaining(`no entry for ${ARCHIVE_NAME}`)
    )
    expect(extractTarMock).not.toHaveBeenCalled()
    expect(addPathMock).not.toHaveBeenCalled()
  })

  it('names the release and the file when the release has no archive for this runner', async () => {
    useInput('v2.9.0')
    jest.spyOn(os, 'platform').mockReturnValue('darwin')
    jest.spyOn(os, 'arch').mockReturnValue('arm64')
    serveRelease(`${ARCHIVE_SHA256}  ${ARCHIVE_NAME}\n`)

    await main.run()

    expect(setFailedMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'Release v2.9.0 has no file dbsnapper_2.9.0_darwin_arm64.tar.gz'
      )
    )
    expect(setFailedMock).toHaveBeenCalledWith(
      expect.stringContaining(
        'supports Linux runners (x64, arm64) and DBSnapper Agent 2.7.1 or newer'
      )
    )
    expect(extractTarMock).not.toHaveBeenCalled()
    expect(addPathMock).not.toHaveBeenCalled()
  })

  // Talks to the real GitHub API (anonymously: no real token in tests) and
  // release downloads (read-only).
  it('latest downloads the archive of the newest full release, which exists', async () => {
    useInput('latest', '')
    const requested: string[] = []
    downloadMock.mockImplementation(async (url: string) => {
      requested.push(url)
      throw new Error('test: stop after the first download')
    })

    await main.run()

    expect(requested).toHaveLength(1)
    // A full release tag carries no pre-release suffix (v3.0.0-pr1)
    expect(requested[0]).toMatch(
      /^https:\/\/github\.com\/dbsnapper\/dbsnapper\/releases\/download\/v\d+\.\d+\.\d+\/dbsnapper_\d+\.\d+\.\d+_linux_amd64\.tar\.gz$/
    )
    const res = await new httpm.HttpClient('install-action-test').head(
      requested[0]
    )
    // An unread response keeps its socket, and Jest, from closing
    await res.readBody()
    expect(res.message.statusCode).toBe(200)
  }, 30000)
})
