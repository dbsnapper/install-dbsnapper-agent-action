/**
 * Unit tests for the action's entrypoint, src/index.ts
 */

import * as lifecycle from '../src/lifecycle'
import * as main from '../src/main'

// Mocked: the real one would end the Jest worker's process
const runToEndMock = jest.spyOn(lifecycle, 'runToEnd').mockResolvedValue()

describe('index', () => {
  it('runs the action to its end when imported', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/index')

    expect(runToEndMock).toHaveBeenCalledWith(main.run)
  })
})
