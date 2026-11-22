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

const FAILURE = '::error::The action failed unexpectedly: '

// The failure line's text as the action gave it: the runner's escaping
// (`%` → %25, CR → %0D, LF → %0A) reversed
function unescapeLine(line: string): string {
  return line
    .slice(FAILURE.length, -EOL.length)
    .replace(/%0D/g, '\r')
    .replace(/%0A/g, '\n')
    .replace(/%25/g, '%')
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

  // Runs an action that rejects with `value`, with the real setFailed: it sets
  // process.exitCode and writes the line. The lines are kept here:
  // mockRestore() also clears mock.calls
  async function failWith(value: unknown): Promise<{
    exitCode: typeof process.exitCode
    errorLines: string[]
    exits: number
  }> {
    const exit = jest.fn()
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
    return {
      exitCode,
      errorLines: written.filter(line => line.startsWith('::error::')),
      exits: exit.mock.calls.length
    }
  }

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
      const { exitCode, errorLines, exits } = await failWith(value)

      expect(exitCode).toBe(1)
      expect(errorLines).toEqual([`${FAILURE}${text}${EOL}`])
      expect(exits).toBe(1)
    }
  )

  test('a rejection whose message cannot be read still fails the step with the fallback text', async () => {
    // An Error whose `message` getter throws: reading it is the first thing
    // the failure line does
    class Unreadable extends Error {
      get message(): string {
        throw new Error('no message')
      }
    }

    const { exitCode, errorLines, exits } = await failWith(new Unreadable())

    expect(exitCode).toBe(1)
    expect(errorLines).toEqual([
      `${FAILURE}a value that cannot be shown as text${EOL}`
    ])
    expect(exits).toBe(1)
  })

  test.each([
    [
      'an object with 200,000 fields',
      Object.fromEntries(
        Array.from({ length: 200_000 }, (_, i) => [`field${i}`, i])
      ),
      '{'
    ],
    ['a 5 MB string', 'x'.repeat(5_000_000), 'x'.repeat(2_000)]
  ])(
    'a rejection with %s gives a failure line of 2,000 characters of text, marked as cut',
    async (_kind, value, start) => {
      const { exitCode, errorLines, exits } = await failWith(value)

      expect(exitCode).toBe(1)
      expect(errorLines).toHaveLength(1)
      // The runner's escaping can make a character of the text 3 of the line
      expect(errorLines[0].length).toBeLessThan(FAILURE.length + 3 * 2_100)
      const text = unescapeLine(errorLines[0])
      expect(text.startsWith(start)).toBe(true)
      expect(text).toMatch(
        /^[\s\S]{2000} \.\.\. \(cut: 2000 of \d+ characters shown\)$/
      )
      expect(exits).toBe(1)
    }
  )

  test('the cut does not split a character made of two UTF-16 units', async () => {
    // The emoji's first half is the text's 2,000th unit: the cut goes before it
    const value = `${'a'.repeat(1_999)}😀${'b'.repeat(10)}`

    const { errorLines } = await failWith(value)

    expect(errorLines).toEqual([
      `${FAILURE}${'a'.repeat(1_999)} ... (cut: 1999 of 2011 characters shown)${EOL}`
    ])
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
