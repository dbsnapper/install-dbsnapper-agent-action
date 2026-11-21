/**
 * Unit tests for src/watchdog.ts. Fake timers: only the watchdog's own timer
 * is involved here, no socket.
 */

import { expect, test } from '@jest/globals'
import { StallError, withWatchdog } from '../src/watchdog'

describe('watchdog.ts', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('data restarts the limit: work that keeps receiving data is never cut', async () => {
    const onStall = jest.fn()
    let refresh = (): void => {}
    let finish = (): void => {}

    const result = withWatchdog(1, onStall, async r => {
      refresh = r
      return new Promise<string>(resolve => {
        finish = () => resolve('done')
      })
    })
    // 4 s in all, but never 1 s without data
    for (let i = 0; i < 5; i++) {
      jest.advanceTimersByTime(800)
      refresh()
    }
    finish()

    await expect(result).resolves.toBe('done')
    expect(onStall).not.toHaveBeenCalled()
  })

  test('the limit without data fails the work and calls onStall', async () => {
    const onStall = jest.fn()

    const result = withWatchdog(1, onStall, async () => new Promise(() => {}))
    jest.advanceTimersByTime(1000)

    await expect(result).rejects.toThrow(new StallError(1))
    expect(onStall).toHaveBeenCalledTimes(1)
  })

  test('the timer is cleared once the work is done, so it cannot hold the process', async () => {
    await withWatchdog(30, jest.fn(), async () => 'done')

    expect(jest.getTimerCount()).toBe(0)
  })
})
