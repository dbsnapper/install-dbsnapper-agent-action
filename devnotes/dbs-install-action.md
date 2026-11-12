# dbs-install-action: the install action skips pre-releases and verifies checksums (F15)

Legend: ✅ works / done · ❌ fails / not done · [INFERENCE] = not verified by a
command · Z = UTC.

- Finding: F15 (medium, agent distribution), plan §2.2 step 7.
- Branch `dbs-install-action` from `main` d2e5b6f; uncommitted until `commit`
  arrives. No push, no tag, no release.

## Summary

- ✅ `version: latest` (the default) installs the newest release that is not a
  pre-release: v2.9.0 today. Before: it picked v3.0.0-pr1, got HTTP 404 and
  installed nothing.
- ✅ The archive is checked against the release's `checksums.txt` (SHA-256)
  before it is unpacked. A mismatch, a missing checksums file or a missing entry
  fails the step; nothing is unpacked or put on `PATH`.
- ✅ Pinned versions (`2.9.0`, `v2.9.0`) work as before and are verified too.
- ✅ README and the `version` input description in `action.yml` say both.

## The change

- `src/util.ts`: `resolveRelease(version)` replaces `getDownloadUrl`. It returns
  the tag, the archive name, the archive URL and the checksums URL.
  - `latest` (or empty) asks `GET /repos/dbsnapper/dbsnapper/releases/latest`.
    GitHub defines that release as the newest one that is neither a draft nor a
    pre-release. Before, the action asked `releases?per_page=1`, the newest
    release of any kind.
  - A non-200 answer (rate limit, outage) fails with the URL and status. Before,
    it failed with a JSON or `undefined` error.
- `src/checksum.ts` (new): `verifyChecksum(archivePath, archiveName, checksums)`
  finds the archive's line in the goreleaser `checksums.txt`, streams the file
  through SHA-256 and throws when there is no entry or the hash differs.
- `src/main.ts`: download the archive → download `checksums.txt` from the same
  release (HTTP 404 → "the release publishes no checksums file") → verify → only
  then `extractTar` and `addPath`.
- `__tests__/`: behaviour tests (next section). Removed the old
  `getDownloadUrl('latest') … toBeTruthy()` and `run … toHaveReturned()` checks:
  both passed whatever the action did.
- `dist/`: rebuilt with `npm run bundle` (the repo's `check-dist` workflow
  compares it).
- `README.md`, `action.yml`: version table (`latest` = newest non-pre-release;
  pinned = exactly that release) and a checksum section that lists the three
  failure messages.
- Release data (read-only,
  `curl -s 'https://api.github.com/repos/dbsnapper/dbsnapper/releases?per_page=100'`):
  - 34 releases; all 34 publish `checksums.txt`. So no release a pinned version
    can install loses its checksums file.
  - The newest, v3.0.0-pr1, is a pre-release. Its archives are named
    `dbsnapper_Linux_x86_64.tar.gz`, not
    `dbsnapper_<version>_linux_amd64.tar.gz` as the action expects; that is why
    it got HTTP 404.

## Tests: before and after

All heavy commands ran under `_rules-fix.md` §3
(`flock /tmp/dbs-heavy.lock nice -n 19 …`).

- **Unit tests, branch:** `npx jest --coverage=false` → 3 suites, 8 tests, 8
  passed, exit 0 (run twice: after `npm ci`, and again after `npm run bundle`).
  - `npm run lint` exit 0; `npm run format:check` exit 0; `npm run bundle`
    exit 0.
  - jest prints "A worker process has failed to exit gracefully" once; the run
    still exits 0. [INFERENCE] an HTTP keep-alive socket of the real-network
    test.
- **Same `__tests__/main.test.ts` against the old code** (`git archive d2e5b6f`
  into `/tmp/dbs-install-action/before-src`, new test file copied in):
  `npx jest --coverage=false __tests__/main.test.ts` → 5 tests, 4 failed, 1
  passed, exit 1.

| Test (`__tests__/main.test.ts`)                                              | Before (d2e5b6f) | After |
| ---------------------------------------------------------------------------- | ---------------- | ----- |
| installs a pinned version whose archive matches the published checksum       | ✅               | ✅    |
| fails without unpacking when the archive does not match its checksum         | ❌               | ✅    |
| fails without unpacking when the release has no checksums file               | ❌               | ✅    |
| fails without unpacking when the checksums file does not list the archive    | ❌               | ✅    |
| latest downloads the archive of the newest full release, which exists (real) | ❌               | ✅    |

- The `latest` test asks the real GitHub API and sends a `HEAD` to the archive
  URL the action requests (read-only). Before, it failed at the URL check:
  received `…/download/v3.0.0-pr1/dbsnapper_3.0.0-pr1_linux_amd64.tar.gz`.
- The pinned test passes before and after: it guards "a pinned version keeps
  working".
- `__tests__/util.test.ts`: `2.7.2` and `v2.7.2` both resolve to the same tag,
  archive and checksums URL with no network call (2 tests, pass).

### End to end: the built `dist/index.js` on alfa (linux arm64), real downloads

Command, per version `v`, in `/tmp/dbs-install-action`:
`INPUT_VERSION=$v RUNNER_TEMP=… RUNNER_TOOL_CACHE=… GITHUB_PATH=… node dist/index.js`,
then `<path from GITHUB_PATH>/dbsnapper --version`.

| `version` | Before (d2e5b6f `dist/`)                                                           | After (branch `dist/`)                                                                           |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `latest`  | ❌ resolves v3.0.0-pr1, `Unexpected HTTP response: 404`, exit 1, nothing on `PATH` | ✅ v2.9.0, `Verified SHA-256 of dbsnapper_2.9.0_linux_arm64.tar.gz`, exit 0, agent reports 2.9.0 |
| `v2.9.0`  | ✅ installed, exit 0, no checksum check                                            | ✅ verified, exit 0, agent reports 2.9.0                                                         |
| `2.7.1`   | not run                                                                            | ✅ verified, exit 0, agent reports 2.7.1                                                         |

- Mismatch and missing-checksums paths ran only in the unit tests: no real
  release has a bad hash, and the action's download URLs are fixed to
  github.com.

## What a user of the action sees

- ✅ `uses: dbsnapper/install-dbsnapper-agent-action@<new release>` with no
  `version` (or `latest`): the step logs
  `Installing DBSnapper Agent v2.9.0 (dbsnapper_2.9.0_linux_amd64.tar.gz)` and
  `Verified SHA-256 of …`, and `dbsnapper` is on `PATH`.
- ✅ `version: 2.9.0`: the same, for that release.
- ❌ (the step fails, nothing installed) with one of:
  - `Checksum mismatch for <archive>: expected SHA-256 …, got …. The download is corrupt or was altered; refusing to install it`
  - `Cannot verify <archive>: downloading <checksums URL> failed (the release publishes no checksums file); refusing to install an unverified archive`
  - `The release's checksums file has no entry for <archive>; refusing to install an unverified archive`
  - `Failed to resolve the latest DBSnapper Agent release: <url> answered HTTP <status>`
- Nothing changes for workflows on `@v1` until Joe releases the action and moves
  the `v1` tag; until then `@v1` keeps the old behaviour.

## Decisions (made in this task)

- `/releases/latest` instead of filtering the release list: GitHub defines it as
  the newest non-draft, non-pre-release release; one request, no paging.
- `checksums.txt` comes from the same release as the archive. It catches a
  corrupted or swapped download, not a release whose files were all replaced
  together; the README says so. Signature checks (cosign/GPG) would need the
  release pipeline to sign first: not in scope.
- The archive download comes first, then `checksums.txt`; nothing is unpacked
  before both are in and match.

## Open items

- **Release the action** (Joe's call): a new tag and moving `v1`. Until then
  users get the old behaviour.
- **macOS and Windows runners were not working before and still are not** [from
  the asset list, not run]: the action builds `dbsnapper_<v>_darwin_<arch>.tar.gz`,
  while releases publish `dbsnapper_<v>_darwin_all.zip`, and no Windows archive exists.
  Out of F15 scope.
- **Pinned versions ≤ 2.7.0** were not installable before either: their linux
  archives use a different file name (0 of the 22 releases from v2.7.0 down have
  `dbsnapper_<v>_linux_amd64.tar.gz`, per the release list above).
- **Unauthenticated GitHub API call for `latest`** (60 requests per hour per
  IP). Unchanged from before; a token input would lift it.
- **CI workflow** (`.github/workflows/ci.yml`) still installs `latest` and
  `v2.7.1`; both pass the new action locally (table above). Not run on GitHub:
  no push.

## Paused: follow-up `dbs-install-action-polish` (IA1–IA5, lint, alerts)

Paused by dbs-conductor (fleet quota cap) on 2026-11-12, before any test run.
Branch `dbs-install-action-polish` from `main` a7a2099. The commit holding
this section is work in progress: **not built, not tested, `dist/` not
rebuilt** (so `check-dist` would fail on it). No push.

Done in source (unverified):

- IA1: `token` input (default `${{ github.token }}`) in `action.yml`; sent as
  `authorization: Bearer …` only on the `api.github.com` lookup
  (`src/util.ts` `getLatestTag`); HTTP 403/429 says "most likely the GitHub
  rate limit" and "Pin a version".
- IA2: archive HTTP 404 names release, file, and "Linux runners (x64, arm64)
  and DBSnapper Agent 2.7.1 or newer" (`src/main.ts`); same line in the
  readme.
- IA3: network and JSON errors of the lookup carry "Failed to resolve the
  latest DBSnapper Agent release".
- IA5 (trivial, so done): `version` must be `latest`, empty, or
  `v?X.Y.Z[-suffix]`.
- IA4: `__tests__/util.test.ts` fakes the lookup (200 with and without token,
  403, 429, network error, invalid versions); `__tests__/main.test.ts` adds
  the archive-404 test and asserts downloads carry no token.
- Lint: run 43292054322 (the only lint run on record, `gh run list`: 1) failed
  in three linters. Cause of the TypeScript parsing errors: super-linter v6
  ignores `TYPESCRIPT_DEFAULT_STYLE` (log line "it's deprecated, and
  super-linter will ignore it"), so ts-standard ran on every file. Fix in
  `.github/workflows/linter.yml`: `VALIDATE_TYPESCRIPT_STANDARD: false`
  (ESLint and Prettier stay). Markdown: `MD013` skips tables and code blocks
  (`.github/linters/.markdown-lint.yml`). Readme terms fixed.

Next steps on resume:

1. Wait for `npm ci` (was running under the heavy lock), then
   `npx jest --coverage=false`, `npm run lint`, `npm run format:check`; fix.
2. Run the new tests against a7a2099 sources (`git archive a7a2099` to /tmp)
   for the before/after table.
3. Dependabot: `npm update undici braces` (undici to 5.29.x via
   `@actions/http-client` ^5.25.4 range; braces to 3.0.3); check
   `package-lock.json`.
4. Fix this file for textlint (prerelease, Jest, end-to-end, filename,
   readme in code spans) and the long list lines 111–113 (move the messages
   into a fenced block). Ideally run super-linter slim v6 locally on loopback
   to prove the lint passes.
5. `npm run bundle`; end-to-end bundle runs for `latest`, `v2.9.0`, `2.7.1`.
6. Private-terms and key-format scans; commit by path; `review` to
   dbs-conductor.
