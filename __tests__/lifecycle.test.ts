/**
 * Unit tests for src/lifecycle.ts. `exit` is a mock: the real one would end
 * the Jest worker's process.
 */

import { expect, test } from '@jest/globals'
import * as core from '@actions/core'
import { ENDED_EARLY, runToEnd } from '../src/lifecycle'

describe('lifecycle.ts', () => {
  let setFailed: jest.SpyInstance

  beforeEach(() => {
    jest.restoreAllMocks()
    setFailed = jest.spyOn(core, 'setFailed').mockImplementation()
  })

  test('ends the process once the action finished, so no connection left open can hold the step', async () => {
    const exit = jest.fn()
    const listeners = process.listenerCount('beforeExit')

    await runToEnd(async () => {}, exit)

    expect(exit).toHaveBeenCalledTimes(1)
    expect(setFailed).not.toHaveBeenCalled()
    expect(process.listenerCount('beforeExit')).toBe(listeners)
  })

  test('fails the step when Node runs out of work before the action finished', async () => {
    const exit = jest.fn()

    // An action whose promise never settles: what http-client's readBody
    // does when the connection closes in the middle of an answer
    void runToEnd(async () => new Promise<void>(() => {}), exit)
    process.emit('beforeExit', 0)

    expect(setFailed).toHaveBeenCalledWith(ENDED_EARLY)
    expect(exit).not.toHaveBeenCalled()
  })
})
