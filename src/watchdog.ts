export class StallError extends Error {
  constructor(readonly seconds: number) {
    super(`no data for ${seconds} seconds`)
    this.name = 'StallError'
  }
}

/**
 * Runs `work` under a watchdog. `work` calls `refresh` whenever data arrives;
 * after `seconds` without a refresh, `onStall` runs (to destroy the
 * connections it can reach) and the returned promise rejects with StallError
 * at once, whether or not `work` ever settles. So a connection nobody can
 * destroy (a proxy that accepts and never answers CONNECT) cannot hold the
 * step past the limit.
 */
export async function withWatchdog<T>(
  seconds: number,
  onStall: () => void,
  work: (refresh: () => void) => Promise<T>
): Promise<T> {
  let rejectStalled: (error: StallError) => void = () => {}
  const stalled = new Promise<never>((_resolve, reject) => {
    rejectStalled = reject
  })
  const timer = setTimeout(() => {
    // Reject first: the errors onStall causes in `work` come later
    rejectStalled(new StallError(seconds))
    onStall()
  }, seconds * 1000)
  const job = work(() => timer.refresh())
  try {
    // After a stall `work` may still reject (its connections were destroyed);
    // race's handler on `job` keeps that from being an unhandled rejection,
    // which would end Node
    return await Promise.race([job, stalled])
  } finally {
    clearTimeout(timer)
  }
}
