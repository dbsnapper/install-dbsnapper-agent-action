import { expect, test } from '@jest/globals'
import { getDownloadUrl } from '../src/util'

import os from 'os'

jest.mock('os')

describe('util.ts', () => {
  test('get latest download url', async () => {
    os.platform = jest.fn().mockReturnValue('linux')
    os.arch = jest.fn().mockReturnValue('amd64')

    await expect(getDownloadUrl('latest')).resolves.toBeTruthy()
  })

  test('get specific version download url', async () => {
    const version = '2.7.2'
    const ops = 'linux'
    const arch = 'amd64'
    const filename = `dbsnapper_${version}_${ops}_${arch}`

    os.platform = jest.fn().mockReturnValue(ops)
    os.arch = jest.fn().mockReturnValue(arch)

    const url = await getDownloadUrl(version)
    expect(url).toEqual(
      `https://github.com/dbsnapper/dbsnapper/releases/download/v${version}/${filename}.tar.gz`
    )
  })
})
