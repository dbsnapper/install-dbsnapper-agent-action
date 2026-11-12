import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import fs from 'fs'
import { verifyChecksum } from './checksum'
import { resolveRelease } from './util'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const version: string = core.getInput('version')
    const release = await resolveRelease(version)
    core.info(
      `Installing DBSnapper Agent ${release.tag} (${release.archiveName})`
    )

    const archive = await tc.downloadTool(release.archiveUrl)

    let checksumsPath: string
    try {
      checksumsPath = await tc.downloadTool(release.checksumsUrl)
    } catch (error) {
      const reason =
        error instanceof tc.HTTPError && error.httpStatusCode === 404
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
