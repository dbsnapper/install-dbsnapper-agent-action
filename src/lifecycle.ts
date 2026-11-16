import * as core from '@actions/core'

export const ENDED_EARLY =
  'The action ended before the install finished (a connection closed without an error); nothing was installed. Run the job again'

/**
 * Runs the action, then ends the process with the exit code the action set.
 * - Ending the process: a connection nobody can destroy (a proxy's tunnel
 *   still waiting for its CONNECT answer) would keep Node, and the step,
 *   running after the action finished, until the job's time limit.
 * - If Node runs out of work before the action finished (a promise that never
 *   settles), it would exit with code 0 and the step would end green with
 *   nothing installed; `beforeExit` fails the step instead.
 */
export async function runToEnd(
  action: () => Promise<void>,
  exit: () => void = () => process.exit()
): Promise<void> {
  let finished = false
  const onBeforeExit = (): void => {
    if (!finished) core.setFailed(ENDED_EARLY)
  }
  process.once('beforeExit', onBeforeExit)
  try {
    await action()
  } finally {
    finished = true
    process.off('beforeExit', onBeforeExit)
    exit()
  }
}
