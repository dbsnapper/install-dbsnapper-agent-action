import * as core from '@actions/core'
import { Writable } from 'stream'
import { inspect } from 'util'

export const ENDED_EARLY =
  'The action ended before the install finished (a connection closed without an error); nothing was installed. Run the job again'

// How long the end waits for the output to be written before it exits anyway
const FLUSH_LIMIT_MS = 10_000

// The failure line shows this many characters of its text at most: a rejected
// object's fields or a long string would otherwise make one line of megabytes
const TEXT_LIMIT = 2_000

/**
 * `text` cut to TEXT_LIMIT characters, with a mark saying so. The cut never
 * falls between the two halves of a character outside the Basic Multilingual
 * Plane (an emoji, for one), which would leave half a character.
 */
function shorten(text: string): string {
  if (text.length <= TEXT_LIMIT) return text
  const last = text.charCodeAt(TEXT_LIMIT - 1)
  const end = last >= 0xd800 && last <= 0xdbff ? TEXT_LIMIT - 1 : TEXT_LIMIT
  return `${text.slice(0, end)} ... (cut: ${end} of ${text.length} characters shown)`
}

/**
 * The failure line's text for any rejection value. Never throws: a template
 * string throws for a Symbol or an object without a prototype, and a getter
 * or a proxy can throw on any access.
 */
function describe(error: unknown): string {
  try {
    const text = error instanceof Error ? error.message : error
    return shorten(typeof text === 'string' ? text : inspect(text))
  } catch {
    return 'a value that cannot be shown as text'
  }
}

/**
 * Runs the action, then ends the process with the exit code the action set.
 * - Ending the process: a connection nobody can destroy (a proxy's tunnel
 *   still waiting for its CONNECT answer) would keep Node, and the step,
 *   running after the action finished, until the job's time limit.
 * - The end waits until `output` (stdout and stderr) has written what is
 *   queued: on Linux a pipe, which is what the runner reads, is asynchronous,
 *   and process.exit() drops writes still queued, the error line among them.
 *   The wait ends after FLUSH_LIMIT_MS: a reader that stays alive but stops
 *   reading would otherwise hold the step until the job's time limit.
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
    core.setFailed(`The action failed unexpectedly: ${describe(error)}`)
  } finally {
    finished = true
    process.off('beforeExit', onBeforeExit)
  }
  // Writes complete in order: the callback of this empty write comes after
  // everything queued before it (or with the stream's error, if it has one)
  let limit: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(
      output.map(
        async stream =>
          new Promise<void>(resolve => {
            stream.write('', () => resolve())
          })
      )
    ),
    new Promise<void>(resolve => {
      limit = setTimeout(resolve, FLUSH_LIMIT_MS)
    })
  ])
  // On the normal path the timer must not keep Node running
  clearTimeout(limit)
  exit()
}
