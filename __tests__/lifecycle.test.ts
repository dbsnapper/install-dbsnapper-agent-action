/**
 * Unit tests for src/lifecycle.ts. `exit` is a mock: the real one would end
 * the Jest worker's process. Fake timers for the flush limit; process.nextTick
 * and setImmediate stay real, streams call back through them.
 */

import { expect, test } from '@jest/globals'
import * as core from '@actions/core'
import { EOL } from 'os'
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
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    setFailed = jest.spyOn(core, 'setFailed').mockImplementation()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('ends the process once the action finished, so no connection left open can hold the step', async () => {
    const exit = jest.fn()
    const listeners = process.listenerCount('beforeExit')

    await runToEnd(async () => {}, exit, [quietOutput()])

    expect(exit).toHaveBeenCalledTimes(1)
    expect(setFailed).not.toHaveBeenCalled()
    expect(process.listenerCount('beforeExit')).toBe(listeners)
    // The flush limit's timer is gone: it cannot keep Node running
    expect(jest.getTimerCount()).toBe(0)
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

  test('a rejection that is a string fails the step with that string', async () => {
    const exit = jest.fn()

    await runToEnd(
      async () => {
        // A value that is not an Error is the point of this test
        // eslint-disable-next-line no-throw-literal
        throw 'plain string'
      },
      exit,
      [quietOutput()]
    )

    expect(setFailed).toHaveBeenCalledWith(
      'The action failed unexpectedly: plain string'
    )
    expect(exit).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['a Symbol', Symbol('boom'), 'Symbol(boom)'],
    [
      'an object without a prototype',
      Object.assign(Object.create(null), { code: 'E1' }),
      "[Object: null prototype] { code: 'E1' }"
    ]
  ])(
    'a rejection with %s, which a template string cannot turn into text, still gives exit code 1 and the error line',
    async (_kind, value, text) => {
      const exit = jest.fn()
      // The real setFailed: it sets process.exitCode and writes the line.
      // The lines are kept here: mockRestore() also clears mock.calls
      setFailed.mockRestore()
      const written: string[] = []
      const stdout = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(chunk => {
          written.push(`${chunk}`)
          return true
        })
      const exitCodeBefore = process.exitCode
      let exitCode: typeof process.exitCode
      try {
        await runToEnd(
          async () => {
            throw value
          },
          exit,
          [quietOutput()]
        )
        exitCode = process.exitCode
      } finally {
        stdout.mockRestore()
        process.exitCode = exitCodeBefore
      }

      expect(exitCode).toBe(1)
      const errorLines = written.filter(line => line.startsWith('::error::'))
      expect(errorLines).toEqual([
        `::error::The action failed unexpectedly: ${text}${EOL}`
      ])
      expect(exit).toHaveBeenCalledTimes(1)
    }
  )

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

  test('the process ends only after every output stream has written, not only the first', async () => {
    const exit = jest.fn()
    const pending: (() => void)[] = []
    const slowOutput = new Writable({
      write(_chunk, _encoding, callback) {
        pending.push(callback)
      }
    })

    const ended = runToEnd(async () => {}, exit, [quietOutput(), slowOutput])
    await nextTurn()
    expect(exit).not.toHaveBeenCalled()

    while (pending.length > 0) {
      pending.shift()?.()
      await nextTurn()
    }
    await ended
    expect(exit).toHaveBeenCalledTimes(1)
  })

  test('a broken or a destroyed output stream does not keep the process from ending', async () => {
    const exit = jest.fn()
    const broken = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('EPIPE'))
      }
    })
    broken.on('error', () => {})
    const destroyed = quietOutput()
    destroyed.destroy()

    const ended = runToEnd(async () => {}, exit, [broken, destroyed])
    // Both callbacks come on the next tick, with the error: no wait for the limit
    await nextTurn()
    await nextTurn()
    expect(exit).toHaveBeenCalledTimes(1)
    await ended
  })

  test('a reader that stays alive but never reads holds the end for 10 s at most', async () => {
    const exit = jest.fn()
    // The write never calls back: a pipe whose reader stopped reading
    const stuckOutput = new Writable({
      write() {}
    })

    void runToEnd(async () => {}, exit, [stuckOutput, quietOutput()])
    await nextTurn()
    jest.advanceTimersByTime(9_999)
    await nextTurn()
    expect(exit).not.toHaveBeenCalled()

    jest.advanceTimersByTime(1)
    await nextTurn()
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
