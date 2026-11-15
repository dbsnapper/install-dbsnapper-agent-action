import { expect, test } from '@jest/globals'
import * as httpm from '@actions/http-client'
import os from 'os'
import { resolveRelease } from '../src/util'

const LATEST_URL =
  'https://api.github.com/repos/dbsnapper/dbsnapper/releases/latest'

// Answers the latest-release lookup with `status` and `body`, without network.
function answerLookup(status: number, body: string): jest.SpyInstance {
  return jest.spyOn(httpm.HttpClient.prototype, 'get').mockResolvedValue({
    message: { statusCode: status },
    readBody: async () => body
  } as unknown as httpm.HttpClientResponse)
}

describe('util.ts', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(os, 'platform').mockReturnValue('linux')
    jest.spyOn(os, 'arch').mockReturnValue('x64')
  })

  test.each(['2.7.2', 'v2.7.2'])(
    'pinned version %s resolves to that release without asking GitHub',
    async version => {
      const get = jest.spyOn(httpm.HttpClient.prototype, 'get')
      await expect(resolveRelease(version, 'workflow-token')).resolves.toEqual({
        tag: 'v2.7.2',
        archiveName: 'dbsnapper_2.7.2_linux_amd64.tar.gz',
        archiveUrl:
          'https://github.com/dbsnapper/dbsnapper/releases/download/v2.7.2/dbsnapper_2.7.2_linux_amd64.tar.gz',
        checksumsUrl:
          'https://github.com/dbsnapper/dbsnapper/releases/download/v2.7.2/checksums.txt'
      })
      expect(get).not.toHaveBeenCalled()
    }
  )

  test.each(['2.9', 'v2.9.0/../../x', '2.9.0 ', 'main', '../2.9.0'])(
    'a version that is not a version number (%s) is refused before any download',
    async version => {
      const get = jest.spyOn(httpm.HttpClient.prototype, 'get')
      await expect(resolveRelease(version)).rejects.toThrow(
        `Invalid version "${version}"`
      )
      expect(get).not.toHaveBeenCalled()
    }
  )

  test('latest resolves to the tag GitHub answers and sends the token to api.github.com', async () => {
    const get = answerLookup(200, JSON.stringify({ tag_name: 'v2.9.0' }))

    await expect(resolveRelease('latest', 'workflow-token')).resolves.toEqual(
      expect.objectContaining({
        tag: 'v2.9.0',
        archiveName: 'dbsnapper_2.9.0_linux_amd64.tar.gz'
      })
    )
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith(LATEST_URL, {
      authorization: 'Bearer workflow-token'
    })
  })

  test('latest without a token asks GitHub anonymously', async () => {
    const get = answerLookup(200, JSON.stringify({ tag_name: 'v2.9.0' }))

    await expect(resolveRelease('')).resolves.toEqual(
      expect.objectContaining({ tag: 'v2.9.0' })
    )
    expect(get).toHaveBeenCalledWith(LATEST_URL, {})
  })

  test.each([403, 429])(
    'a refused lookup (HTTP %d) names the GitHub rate limit and pinning a version',
    async status => {
      answerLookup(status, '{"message":"API rate limit exceeded"}')

      const lookup = resolveRelease('latest')
      await expect(lookup).rejects.toThrow(
        `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL} answered HTTP ${status}`
      )
      await expect(lookup).rejects.toThrow('GitHub rate limit')
      await expect(lookup).rejects.toThrow('Pin a version')
    }
  )

  test('a refused token (HTTP 401) says so and names pinning a version or a valid token', async () => {
    answerLookup(401, '{"message":"Bad credentials"}')

    const lookup = resolveRelease('latest', 'expired-token')
    await expect(lookup).rejects.toThrow(
      `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL} answered HTTP 401: GitHub refused the token`
    )
    await expect(lookup).rejects.toThrow('Pin a version')
    await expect(lookup).rejects.toThrow('pass a valid token')
  })

  test.each(['release-3', 'vv2.9.0', '../x', 'v2.9.0/../../x', 'v2.9.0?x'])(
    'a latest tag that is not a version number (%s) is refused like the version input',
    async tag => {
      answerLookup(200, JSON.stringify({ tag_name: tag }))

      await expect(resolveRelease('latest')).rejects.toThrow(
        `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL} returned the tag ${JSON.stringify(tag)}, which is not a version number`
      )
    }
  )

  test('a JSON null answer fails with the lookup prefix', async () => {
    answerLookup(200, 'null')

    await expect(resolveRelease('latest')).rejects.toThrow(
      `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL} returned no tag`
    )
  })

  test('a network error during the lookup says which lookup failed', async () => {
    jest
      .spyOn(httpm.HttpClient.prototype, 'get')
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'))

    await expect(resolveRelease('latest')).rejects.toThrow(
      `Failed to resolve the latest DBSnapper Agent release: ${LATEST_URL}: getaddrinfo ENOTFOUND api.github.com`
    )
  })
})
