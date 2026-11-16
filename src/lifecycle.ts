import * as core from '@actions/core'
import { Writable } from 'stream'

export const ENDED_EARLY =
  'The action ended before the install finished (a connection closed without an error); nothing was installed. Run the job again'

/**
 * Runs the action, then ends the process with the exit code the action set.
 * - Ending the process: a connection nobody can destroy (a proxy's tunnel
 *   still waiting for its CONNECT answer) would keep Node, and the step,
 *   running after the action finished, until the job's time limit.
 * - The end waits until `output` (stdout and stderr) has written what is
 *   queued: on Linux a pipe, which is what the runner reads, is asynchronous,
 *   and process.exit() drops writes still queued, the error line among them.
 * - An action that rejects fails the step with its error; otherwise the exit
 *   code would still be 0 (nothing called setFailed) and the step green.
 * - If Node runs out of work before the action finished (a promise that never
 *   settles), it would exit with code 0 and the step would end green with
 *   nothing installed; `beforeExit` fails the step instead.
 */
export async function runToEnd(
  action: () => Promise<void>,
  exit: () => void = () => process.exit(),
  output: Writable[] = [process.stdout, process.stderr]
): Promise<void> {
  let finished = false
  const onBeforeExit = (): void => {
    if (!finished) core.setFailed(ENDED_EARLY)
  }
  process.once('beforeExit', onBeforeExit)
  try {
    await action()
  } catch (error) {
    core.setFailed(
      `The action failed unexpectedly: ${error instanceof Error ? error.message : error}`
    )
  } finally {
    finished = true
    process.off('beforeExit', onBeforeExit)
  }
  // Writes complete in order: the callback of this empty write comes after
  // everything queued before it (or with the stream's error, if it has one)
  await Promise.all(
    output.map(
      async stream =>
        new Promise<void>(resolve => {
          stream.write('', () => resolve())
        })
    )
  )
  exit()
}
