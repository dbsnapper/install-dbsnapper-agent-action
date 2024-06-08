import * as core from '@actions/core'
import * as tc from '@actions/tool-cache'
import { getDownloadUrl } from './util'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const version: string = core.getInput('version')

    // Download the specific version of the tool
    const archive = await tc.downloadTool(await getDownloadUrl(version))

    // Extract the tarball onto the runner
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
