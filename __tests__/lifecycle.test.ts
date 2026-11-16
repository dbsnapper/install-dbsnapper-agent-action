/**
 * Unit tests for src/lifecycle.ts. `exit` is a mock: the real one would end
 * the Jest worker's process.
 */

import { expect, test } from '@jest/globals'
import * as core from '@actions/core'
import { Writable } from 'stream'
import { setImmediate as nextTurn } from 'timers/promises'
import { ENDED_EARLY, runToEnd } from '../src/lifecycle'

// A stream that writes at once
function quietOutput(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    }
  })
}

describe('lifecycle.ts', () => {
  let setFailed: jest.SpyInstance

  beforeEach(() => {
    jest.restoreAllMocks()
    setFailed = jest.spyOn(core, 'setFailed').mockImplementation()
  })

  test('ends the process once the action finished, so no connection left open can hold the step', async () => {
    const exit = jest.fn()
    const listeners = process.listenerCount('beforeExit')

    await runToEnd(async () => {}, exit, [quietOutput()])

    expect(exit).toHaveBeenCalledTimes(1)
    expect(setFailed).not.toHaveBeenCalled()
    expect(process.listenerCount('beforeExit')).toBe(listeners)
  })

  test('an action that rejects fails the step with its error, not exit code 0', async () => {
    const exit = jest.fn()

    await runToEnd(
      async () => {
        throw new Error('boom')
      },
      exit,
      [quietOutput()]
    )

    expect(setFailed).toHaveBeenCalledWith(
      'The action failed unexpectedly: boom'
    )
    expect(exit).toHaveBeenCalledTimes(1)
  })

  test('the process ends only after the output queued before has been written', async () => {
    const exit = jest.fn()
    // A pipe whose reader is slow: each write completes when the test says
    const pending: (() => void)[] = []
    const written: string[] = []
    const slowOutput = new Writable({
      write(chunk, _encoding, callback) {
        pending.push(() => {
          written.push(`${chunk}`)
          callback()
        })
      }
    })
    slowOutput.write('::error::the last line\n')

    const ended = runToEnd(async () => {}, exit, [slowOutput, quietOutput()])
    await nextTurn()
    expect(exit).not.toHaveBeenCalled()

    // The queued line, then the empty marker write behind it
    while (pending.length > 0) {
      pending.shift()?.()
      await nextTurn()
    }
    await ended
    expect(written[0]).toBe('::error::the last line\n')
    expect(exit).toHaveBeenCalledTimes(1)
  })

  test('fails the step when Node runs out of work before the action finished', async () => {
    const exit = jest.fn()

    // An action whose promise never settles: what http-client's readBody
    // does when the connection closes in the middle of an answer
    void runToEnd(async () => new Promise<void>(() => {}), exit, [
      quietOutput()
    ])
    process.emit('beforeExit', 0)

    expect(setFailed).toHaveBeenCalledWith(ENDED_EARLY)
    expect(exit).not.toHaveBeenCalled()
  })
})
