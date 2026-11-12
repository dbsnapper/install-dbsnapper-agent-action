import { expect, test } from '@jest/globals'
import os from 'os'
import { resolveRelease } from '../src/util'

describe('util.ts', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(os, 'platform').mockReturnValue('linux')
    jest.spyOn(os, 'arch').mockReturnValue('x64')
  })

  test.each(['2.7.2', 'v2.7.2'])(
    'pinned version %s resolves to that release without asking GitHub',
    async version => {
      await expect(resolveRelease(version)).resolves.toEqual({
        tag: 'v2.7.2',
        archiveName: 'dbsnapper_2.7.2_linux_amd64.tar.gz',
        archiveUrl:
          'https://github.com/dbsnapper/dbsnapper/releases/download/v2.7.2/dbsnapper_2.7.2_linux_amd64.tar.gz',
        checksumsUrl:
          'https://github.com/dbsnapper/dbsnapper/releases/download/v2.7.2/checksums.txt'
      })
    }
  )
})
