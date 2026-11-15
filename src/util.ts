import * as httpm from '@actions/http-client'
import { OutgoingHttpHeaders } from 'http'
import os from 'os'

const REPO = 'dbsnapper/dbsnapper'
const CHECKSUMS_FILE = 'checksums.txt'

// arch in [arm, x32, x64...] (https://nodejs.org/api/os.html#os_os_arch)
// return value in [amd64, 386, arm]
function mapArch(arch: string): string {
  const mappings: Record<string, string> = {
    x32: '386',
    x64: 'amd64'
  }
  return mappings[arch] || arch
}

// os in [darwin, linux, win32...] (https://nodejs.org/api/os.html#os_os_platform)
// return value in [darwin, linux, windows]
function mapOS(ops: string): string {
  const mappings: Record<string, string> = {
    darwin: 'darwin',
    win32: 'windows'
  }
  return mappings[ops] || ops
}

// Parsed from GitHub's answer, so nothing about its shape is guaranteed
interface GithubReleaseResponse {
  tag_name?: unknown
}

export interface AgentRelease {
  // Release tag, always with a leading `v` (v2.9.0)
  tag: string
  // File name of the agent archive for this runner, as listed in the checksums file
  archiveName: string
  archiveUrl: string
  // The release's published checksums file
  checksumsUrl: string
}

function stripLeadingV(version: string): string {
  return version.replace(/^v/, '')
}

function releaseFileUrl(tag: string, file: string): string {
  return `https://github.com/${REPO}/releases/download/${tag}/${file}`
}

// A release version as the agent's tags spell it: 2.9.0, v2.9.0, v3.0.0-pr1
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/

/**
 * Resolves the release to install: `latest` (or no version) is the newest
 * published release that is not a prerelease; anything else must be a version
 * number (`2.9.0` or `v2.9.0`) and is installed as pinned. `token` is sent only
 * to api.github.com, for the `latest` lookup.
 */
export async function resolveRelease(
  version?: string,
  token?: string
): Promise<AgentRelease> {
  let tag: string
  if (!version || version === 'latest') {
    tag = await getLatestTag(token)
  } else if (VERSION_PATTERN.test(version)) {
    tag = `v${stripLeadingV(version)}`
  } else {
    throw new Error(
      `Invalid version "${version}": use latest or a version number such as 2.9.0`
    )
  }
  const ops = mapOS(os.platform())
  const arch = mapArch(os.arch())
  const archiveName = `dbsnapper_${stripLeadingV(tag)}_${ops}_${arch}.tar.gz`
  return {
    tag,
    archiveName,
    archiveUrl: releaseFileUrl(tag, archiveName),
    checksumsUrl: releaseFileUrl(tag, CHECKSUMS_FILE)
  }
}

function latestLookupError(reason: string): Error {
  return new Error(
    `Failed to resolve the latest DBSnapper Agent release: ${reason}`
  )
}

// GitHub's "latest release" is the newest release that is neither a draft
// nor a prerelease:
// https://docs.github.com/en/rest/releases/releases#get-the-latest-release
async function getLatestTag(token?: string): Promise<string> {
  const httpClient = new httpm.HttpClient('dbsnapper-install-gh-action', [], {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  const url = `https://api.github.com/repos/${REPO}/releases/latest`
  const headers: OutgoingHttpHeaders = token
    ? { authorization: `Bearer ${token}` }
    : {}
  let status: number | undefined
  let body: string
  try {
    const res = await httpClient.get(url, headers)
    status = res.message.statusCode
    body = await res.readBody()
  } catch (error) {
    throw latestLookupError(
      `${url}: ${error instanceof Error ? error.message : error}`
    )
  }
  if (status === 401 && token) {
    throw latestLookupError(
      `${url} answered HTTP 401: GitHub refused the token. Pin a version (version: 2.9.0) to skip this lookup, or pass a valid token (token input)`
    )
  }
  if (status === 403 || status === 429) {
    throw latestLookupError(
      `${url} answered HTTP ${status}, most likely the GitHub rate limit. Pin a version (version: 2.9.0) to skip this lookup, or pass a token with a higher limit (token input)`
    )
  }
  if (status !== 200) {
    throw latestLookupError(`${url} answered HTTP ${status}`)
  }
  let release: GithubReleaseResponse | null
  try {
    release = JSON.parse(body)
  } catch (error) {
    throw latestLookupError(
      `${url} returned no JSON (${error instanceof Error ? error.message : error})`
    )
  }
  const tag = release?.tag_name
  if (!tag) {
    throw latestLookupError(`${url} returned no tag`)
  }
  // GitHub's answer gets the same check as the version input
  if (typeof tag !== 'string' || !VERSION_PATTERN.test(tag)) {
    throw latestLookupError(
      `${url} returned the tag ${JSON.stringify(tag)}, which is not a version number`
    )
  }
  return `v${stripLeadingV(tag)}`
}
