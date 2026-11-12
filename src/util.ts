import * as httpm from '@actions/http-client'
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

interface GithubReleaseResponse {
  tag_name: string
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

/**
 * Resolves the release to install: `latest` (or no version) is the newest
 * published release that is not a pre-release; anything else is taken as a
 * pinned version (`2.9.0` or `v2.9.0`).
 */
export async function resolveRelease(version?: string): Promise<AgentRelease> {
  const tag =
    !!version && version !== 'latest'
      ? `v${stripLeadingV(version)}`
      : await getLatestTag()
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

// GitHub's "latest release" is the newest release that is neither a draft
// nor a pre-release:
// https://docs.github.com/en/rest/releases/releases#get-the-latest-release
async function getLatestTag(): Promise<string> {
  const httpClient = new httpm.HttpClient('dbsnapper-install-gh-action', [], {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  const url = `https://api.github.com/repos/${REPO}/releases/latest`
  const res = await httpClient.get(url)
  const body = await res.readBody()
  if (res.message.statusCode !== 200) {
    throw new Error(
      `Failed to resolve the latest DBSnapper Agent release: ${url} answered HTTP ${res.message.statusCode}`
    )
  }
  const release: GithubReleaseResponse = JSON.parse(body)
  if (!release.tag_name) {
    throw new Error(
      `Failed to resolve the latest DBSnapper Agent release: ${url} returned no tag`
    )
  }
  return `v${stripLeadingV(release.tag_name)}`
}
