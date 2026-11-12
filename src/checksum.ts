import crypto from 'crypto'
import fs from 'fs'

/**
 * Checks `archivePath` against its entry in a goreleaser checksums file
 * (`<sha256>  <file name>` per line). Throws when the file name has no entry
 * or the SHA-256 differs.
 */
export async function verifyChecksum(
  archivePath: string,
  archiveName: string,
  checksums: string
): Promise<void> {
  let expected: string | undefined
  for (const line of checksums.split('\n')) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line)
    if (match && match[2] === archiveName) {
      expected = match[1].toLowerCase()
      break
    }
  }
  if (!expected) {
    throw new Error(
      `The release's checksums file has no entry for ${archiveName}; refusing to install an unverified archive`
    )
  }

  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(archivePath)) {
    hash.update(chunk)
  }
  const actual = hash.digest('hex')
  if (actual !== expected) {
    throw new Error(
      `Checksum mismatch for ${archiveName}: expected SHA-256 ${expected}, got ${actual}. The download is corrupt or was altered; refusing to install it`
    )
  }
}
