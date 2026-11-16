/**
 * The entrypoint for the action.
 */
import { runToEnd } from './lifecycle'
import { run } from './main'

// eslint-disable-next-line @typescript-eslint/no-floating-promises
runToEnd(run)
