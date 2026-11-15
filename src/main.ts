import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import fs from 'fs'
import { verifyChecksum } from './checksum'
import { DownloadError, downloadFile } from './download'
import { resolveRelease } from './util'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const version: string = core.getInput('version')
    const token: string = core.getInput('token')
    if (token) {
      // The runner masks the job token and secrets; this covers a literal one
      core.setSecret(token)
    }
    const release = await resolveRelease(version, token)
    core.info(
      `Installing DBSnapper Agent ${release.tag} (${release.archiveName})`
    )

    let archive: string
    try {
      archive = await downloadFile(release.archiveUrl)
    } catch (error) {
      if (error instanceof DownloadError && error.httpStatusCode === 404) {
        throw new Error(
          `Release ${release.tag} has no file ${release.archiveName} (HTTP 404 for ${release.archiveUrl}). The action supports Linux runners (x64, arm64) and DBSnapper Agent 2.7.1 or newer`
        )
      }
      throw new Error(
        `Failed to download ${release.archiveName} from ${release.archiveUrl}: ${error instanceof Error ? error.message : error}`
      )
    }

    let checksumsPath: string
    try {
      checksumsPath = await downloadFile(release.checksumsUrl)
    } catch (error) {
      const reason =
        error instanceof DownloadError && error.httpStatusCode === 404
          ? 'the release publishes no checksums file'
          : `${error instanceof Error ? error.message : error}`
      throw new Error(
        `Cannot verify ${release.archiveName}: downloading ${release.checksumsUrl} failed (${reason}); refusing to install an unverified archive`
      )
    }

    // Verify before unpacking: nothing from an unverified archive reaches the runner
    await verifyChecksum(
      archive,
      release.archiveName,
      await fs.promises.readFile(checksumsPath, 'utf8')
    )
    core.info(`Verified SHA-256 of ${release.archiveName}`)

    const agent = await tc.extractTar(archive)

    // Expose the tool by adding it to the PATH
    core.addPath(agent)
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else if (typeof error === 'string') {
      core.setFailed(error)
    } else {
      core.setFailed(`unknown error: ${error}`)
    }
  }
}
