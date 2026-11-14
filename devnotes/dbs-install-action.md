# dbs-install-action: no prereleases, verified checksums (F15)

Legend: ✅ works / done · ❌ fails / not done · [INFERENCE] = not verified by a
command · Z = UTC.

- Finding: F15 (medium, agent distribution), plan §2.2 step 7.
- Branch `dbs-install-action` from `main` d2e5b6f; committed as 6b88b0f and
  merged into `main` as a7a2099. No tag, no release.
- Follow-up (IA1–IA5, lint, Dependabot): section
  [Follow-up](#follow-up-dbs-install-action-polish) at the end.

## Summary

- ✅ `version: latest` (the default) installs the newest release that is not a
  prerelease: v2.9.0 today. Before: it picked v3.0.0-pr1, got HTTP 404 and
  installed nothing.
- ✅ The archive is checked against the release's `checksums.txt` (SHA-256)
  before it is unpacked. A mismatch, a missing checksums file or a missing entry
  fails the step; nothing is unpacked or put on `PATH`.
- ✅ Pinned versions (`2.9.0`, `v2.9.0`) work as before and are verified too.
- ✅ The readme and the `version` input description in `action.yml` say both.

## The change

- `src/util.ts`: `resolveRelease(version)` replaces `getDownloadUrl`. It returns
  the tag, the archive name, the archive URL and the checksums URL.
  - `latest` (or empty) asks `GET /repos/dbsnapper/dbsnapper/releases/latest`.
    GitHub defines that release as the newest one that is neither a draft nor a
    prerelease. Before, the action asked `releases?per_page=1`, the newest
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
- `README.md`, `action.yml`: version table (`latest` = newest non-prerelease;
  pinned = exactly that release) and a checksum section that lists the three
  failure messages.
- Release data (read-only,
  `curl -s 'https://api.github.com/repos/dbsnapper/dbsnapper/releases?per_page=100'`):
  - 34 releases; all 34 publish `checksums.txt`. So no release a pinned version
    can install loses its checksums file.
  - The newest, v3.0.0-pr1, is a prerelease. Its archives are named
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
  - Jest prints "A worker process has failed to exit gracefully" once; the run
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

### End-to-end: the built `dist/index.js` on alfa (linux arm64), real downloads

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
- ❌ (the step fails, nothing installed) with one of these messages:

  ```text
  Checksum mismatch for <archive>: expected SHA-256 …, got ….
    The download is corrupt or was altered; refusing to install it
  Cannot verify <archive>: downloading <checksums URL> failed
    (the release publishes no checksums file); refusing to install an
    unverified archive
  The release's checksums file has no entry for <archive>; refusing to
    install an unverified archive
  Failed to resolve the latest DBSnapper Agent release: <url> answered
    HTTP <status>
  ```

- Nothing changes for workflows on `@v1` until Joe releases the action and moves
  the `v1` tag; until then `@v1` keeps the old behaviour.

## Decisions (made in this task)

- `/releases/latest` instead of filtering the release list: GitHub defines it as
  the newest non-draft, non-prerelease release; one request, no paging.
- `checksums.txt` comes from the same release as the archive. It catches a
  corrupted or swapped download, not a release whose files were all replaced
  together; the readme says so. Signature checks (cosign/GPG) would need the
  release pipeline to sign first: not in scope.
- The archive download comes first, then `checksums.txt`; nothing is unpacked
  before both are in and match.

## Open items

- **Release the action** (Joe's call): a new tag and moving `v1`. Until then
  users get the old behaviour.
- **macOS and Windows runners were not working before and still are not**
  [from the asset list, not run]: the action builds
  `dbsnapper_<v>_darwin_<arch>.tar.gz`, while releases publish
  `dbsnapper_<v>_darwin_all.zip`, and no Windows archive exists. Out of F15
  scope.
- **Pinned versions ≤ 2.7.0** were not installable before either: their linux
  archives use a different filename (0 of the 22 releases from v2.7.0 down have
  `dbsnapper_<v>_linux_amd64.tar.gz`, per the release list above).
- **Unauthenticated GitHub API call for `latest`** (60 requests per hour per
  IP): addressed by the follow-up's `token` input (IA1).
- **CI workflow** (`.github/workflows/ci.yml`) still installs `latest` and
  `v2.7.1`; both pass the new action locally (table above). Not run on GitHub:
  no push.

## Follow-up: dbs-install-action-polish

Branch `dbs-install-action-polish` from `main` a7a2099, for review findings
IA1–IA5 (`reports/review-dbs-install-action.md`), the failing `Lint Codebase`
run and three Dependabot alerts. Decision A (`install action: merge, polish
before v1`). No push by me, no tag, no release.

State on 2026-11-14 21:40Z: **work in progress**. Source, tests, docs and lint
configuration are written; the test, lint, bundle and dependency runs are
blocked by the alfa load brake (no Node test or lint runs until 23:15Z, then
one test file at a time). `dist/` is **not** rebuilt yet, so `check-dist`
fails on this branch until step 4 below.

### The change

- **IA1 (token):** `action.yml` gains a `token` input, default
  `${{ github.token }}`. `src/util.ts` sends it as `authorization: Bearer …`
  on the one `api.github.com` lookup for `latest`, never with the
  `github.com` release downloads. HTTP 403 or 429 fails with
  `… answered HTTP 403, most likely the GitHub rate limit. Pin a version
  (version: 2.9.0) to skip this lookup, or pass a token with a higher limit`.
- **IA2 (missing archive):** an HTTP 404 for the archive fails with
  `Release v2.9.0 has no file dbsnapper_2.9.0_darwin_arm64.tar.gz (HTTP 404
  for …). The action supports Linux runners (x64, arm64) and DBSnapper Agent
  2.7.1 or newer` (`src/main.ts`). The readme has the same sentence.
- **IA3 (network error):** network errors and answers that are not JSON both
  start with `Failed to resolve the latest DBSnapper Agent release:`.
- **IA5 (version format, trivial so done):** `version` must be `latest`,
  empty, or a version number (`2.9.0`, `v2.9.0`, `v3.0.0-pr1`); anything else
  fails with `Invalid version "…"` before any request. All 34 published tags
  match the pattern [INFERENCE: tag list read in the F15 work, pattern not run
  against it].
- **IA4 (tests):**
  - `__tests__/util.test.ts` fakes the GitHub answer (no network): 200 with a
    token (token sent to `api.github.com`), 200 without (anonymous), 403, 429,
    network error, 5 invalid versions; pinned versions make no request.
  - `__tests__/main.test.ts`: new test for the missing archive (IA2 message,
    nothing unpacked); the pinned test now asserts that the two release
    downloads get no token. The live `latest` test stays as the canary.
- **Lint (`Lint Codebase`, run 43292054322 on a7a2099, the only run on record:
  `gh run list --workflow linter.yml` = 1):** three linters failed.
  - TypeScript parsing errors on every file: super-linter v6 ignores
    `TYPESCRIPT_DEFAULT_STYLE` (its log: "it's deprecated, and super-linter
    will ignore it"), so ts-standard ran with its own parser setup. This is
    configuration, not my change; the same files pass ESLint and Prettier in
    the same run. Fix: `VALIDATE_TYPESCRIPT_STANDARD: false` in
    `.github/workflows/linter.yml`.
  - Markdown line length: `MD013` now skips tables and code blocks
    (`.github/linters/.markdown-lint.yml`); Prettier wraps prose at 80 but
    cannot wrap table rows. This file's long message lines are in a fenced
    block now.
  - Natural language (terminology): the flagged terms in this file and the
    readme are reworded (prerelease, Jest, end-to-end, filename, readme).
  - Local check so far: `markdownlint-cli` 0.41.0 (super-linter v6's version)
    with the repo's config: the readme 0 errors; this file 6 errors, all in
    the section this one replaced. The textlint run did not load its rule (my
    invocation); rerun pending.
- **Dependabot:** not done yet. Plan: `npm update undici braces` within the
  current ranges: undici 5.28.4 → 5.29.0 (runtime, through
  `@actions/http-client` `^5.25.4`; fixes the low and the medium alert),
  braces 3.0.2 → 3.0.3 (development; pulls fill-range 7.0.1 → 7.1.x; fixes
  the high alert). Both versions exist (`npm view`).

### Runs done

| Run (under `flock /tmp/dbs-heavy.lock nice -n 19`)          | Result                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm ci`                                                    | exit 0, 570 packages                                               |
| `npx jest --coverage=false __tests__/util.test.ts`, 1st run | exit 1: compile error, header type in `src/util.ts:100`; now fixed |

### Runs needed (in this order, one file at a time, after 23:15Z)

1. `npx tsc -p .github/linters/tsconfig.json`, then
   `npx jest --coverage=false --forceExit __tests__/util.test.ts`, then the
   same for `__tests__/main.test.ts` and `__tests__/index.test.ts`.
2. Before/after: the same two test files against a7a2099 in
   `/tmp/dbs-polish/before` (prepared: `git archive a7a2099`, new tests copied
   in), with ts-jest diagnostics off so each test reports on its own.
3. `npm update undici braces`; check `package-lock.json` (undici 5.29.0,
   braces 3.0.3, `package.json` unchanged).
4. `npm run bundle` (also runs Prettier over all files), `npm run lint`,
   `npm run format:check`, then `git diff --stat dist/`.
5. End-to-end with the built bundle: `latest`, `v2.9.0`, `2.7.1` as in the F15
   table, plus `version: 2.9` (expect `Invalid version`).
6. markdownlint and textlint (super-linter v6 versions) on the readme and this
   file.
7. Private-terms and key-format scans; commit by path; `review`.

### Decisions (made in this task)

- Token default `${{ github.token }}` rather than empty: every workflow has
  it, and it lifts the anonymous limit with no setup. It goes only to
  `api.github.com`; the release files are public and need none.
- 403 and 429 both named as the rate limit: GitHub answers a spent limit with
  either. A 403 for another reason gets the same hint, which still points at
  the fix (pin a version).
- IA5 done, since it is one pattern and a test.
- ts-standard switched off instead of configured: the repo already lints
  TypeScript with ESLint (its own rules) and Prettier, in CI and in
  super-linter.
