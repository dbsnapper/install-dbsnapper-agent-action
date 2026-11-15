# dbs-install-action: no prereleases, verified checksums (F15)

Legend: ✅ works / done · ❌ fails / not done · [INFERENCE] = not verified by a
command · Z = UTC.

- Finding: F15 (medium, agent distribution), plan §2.2 step 7.
- Branch `dbs-install-action` from `main` d2e5b6f; committed as 6b88b0f and
  merged into `main` as a7a2099. No tag, no release.
- Follow-up (IA1–IA5, lint, Dependabot, then IA6 after its review): section
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

### End-to-end: the built `dist/index.js` on alfa (Linux arm64), real downloads

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
- **macOS and Windows runners were not working before and still are not** [from
  the asset list, not run]: the action builds
  `dbsnapper_<v>_darwin_<arch>.tar.gz`, while releases publish
  `dbsnapper_<v>_darwin_all.zip`, and no Windows archive exists. Out of F15
  scope.
- **Pinned versions ≤ 2.7.0** were not installable before either: their Linux
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
run and three Dependabot alerts. Decision A
(`install action: merge, polish before v1`). No push by me, no tag, no release.

State on 2026-11-14 23:38Z: done, waiting for review (second round: direct
dependencies within their majors, decided `install action: deps, minor now`).
Every run below ran on alfa under the conductor's load brake
(`flock /tmp/dbs-heavy.lock`, `GOMAXPROCS=2 nice -n 19`, load1 < 16, memory PSI
avg60 < 5 from 23:29Z, one test file at a time). No CI run: no push.

### Follow-up changes

- **IA1 (token):** `action.yml` gains a `token` input, default
  `${{ github.token }}`. `src/util.ts` sends it as `authorization: Bearer …` on
  the one `api.github.com` lookup for `latest`, never with the `github.com`
  release downloads. HTTP 403 or 429 fails with the message in the block below.
- **IA2 (missing archive):** an HTTP 404 for the archive fails with the release,
  the file and the supported runners and versions (`src/main.ts`). The readme
  has the same sentence under Usage.
- **IA3 (network error):** network errors and answers that are not JSON both
  start with `Failed to resolve the latest DBSnapper Agent release:`.
- **IA5 (version format, trivial so done):** `version` must be `latest`, empty,
  or a version number (`2.9.0`, `v2.9.0`, `v3.0.0-pr1`); anything else fails
  with `Invalid version "…"` before any request. All 34 published release tags
  match the pattern (`gh api 'repos/dbsnapper/dbsnapper/releases?per_page=100'`:
  34 tags, `grep -c -E` with the pattern: 34).
- **IA4 (tests):**
  - `__tests__/util.test.ts` fakes the GitHub answer (no network): 200 with a
    token (token sent to `api.github.com`), 200 without (anonymous), 403, 429,
    network error, 5 invalid versions; pinned versions make no request.
  - `__tests__/main.test.ts`: new test for the missing archive (IA2 message,
    nothing unpacked); the pinned test now asserts that the two release
    downloads get no token. The live `latest` test stays as the canary and asks
    anonymously (tests hold no real token).

The new messages:

```text
Failed to resolve the latest DBSnapper Agent release:
  https://api.github.com/repos/dbsnapper/dbsnapper/releases/latest answered
  HTTP 403, most likely the GitHub rate limit. Pin a version (version: 2.9.0)
  to skip this lookup, or pass a token with a higher limit (token input)
Failed to resolve the latest DBSnapper Agent release:
  https://api.github.com/repos/dbsnapper/dbsnapper/releases/latest:
  getaddrinfo ENOTFOUND api.github.com
Release v2.9.0 has no file dbsnapper_2.9.0_darwin_arm64.tar.gz (HTTP 404 for
  …). The action supports Linux runners (x64, arm64) and DBSnapper Agent 2.7.1
  or newer
Invalid version "2.9": use latest or a version number such as 2.9.0
```

### Lint

`Lint Codebase` run 43292054322 on a7a2099 (the only run of that workflow on
record: `gh run list --workflow linter.yml` = 1) failed in three linters:

- **TypeScript parsing errors on every file, untouched ones included:**
  super-linter v6 ignores `TYPESCRIPT_DEFAULT_STYLE` (its log: "it's deprecated,
  and super-linter will ignore it"), so ts-standard ran with its own parser
  setup. Configuration, not the F15 change: the same files passed ESLint
  (`TYPESCRIPT_ES`) and Prettier in the same run. Fix:
  `VALIDATE_TYPESCRIPT_STANDARD: false` in `.github/workflows/linter.yml`.
- **Markdown line length:** `MD013` now skips tables and code blocks
  (`.github/linters/.markdown-lint.yml`); Prettier wraps prose at 80 but cannot
  wrap table rows. Long messages in this file are in fenced blocks.
- **Natural language (terminology):** the flagged terms in this file and the
  readme are reworded (prerelease, Jest, end-to-end, filename, readme).
- Not run: super-linter itself (a large container image on a loaded host). Its
  two failing Markdown and natural-language linters ran locally at super-linter
  v6's versions and settings (table below).

### Dependabot

- `npm update undici braces`, within the current ranges: undici 5.28.4 → 5.29.0
  (runtime, through `@actions/http-client` `^5.25.4`; the low and the medium
  alert), braces 3.0.2 → 3.0.3 (development; with fill-range 7.0.1 → 7.1.1; the
  high alert). `package.json` unchanged; `package-lock.json` 3 packages.
- `npm audit` then listed 28 advisories (8 low, 8 moderate, 12 high), more than
  the 3 open Dependabot alerts.

### Direct dependencies within their majors (second round)

Decision `install action: deps, minor now` (dbs-conductor, 11-14).

- `npm update --save` (23:16Z, exit 0; npm warned once "ERESOLVE overriding peer
  dependency"): every direct dependency to the newest version within its current
  major; `package.json` ranges follow.
  - Runtime: `@actions/core` 1.10.1 → 1.11.1, `@actions/http-client` 2.2.1 →
    2.2.3, `@actions/tool-cache` 2.0.1 → 2.0.2. uuid is gone from the bundle
    (`dist/licenses.txt` drops it).
  - Development: `@types/jest` 29.5.14, `@types/node` 20.19.43, `@vercel/ncc`
    0.38.4, `eslint` 8.57.1, `eslint-plugin-github` 5.1.8, `eslint-plugin-jest`
    28.14.0, `eslint-plugin-jsonc` 2.21.1, `eslint-plugin-prettier` 5.5.7,
    `prettier` 3.10.1, `prettier-eslint` 16.4.2, `ts-jest` 29.4.15, `typescript`
    5.9.3. Unchanged: `jest` and `@jest/globals` 29.7.0, `@typescript-eslint/*`
    7.18.0, `make-coverage-badge` 1.2.0 (already newest in their majors).
- `npm audit fix` (no `--force`, 23:32Z): exit 1, nothing more it could fix
  without a new major version.
- `npm audit` after: **18** advisories (7 low, 5 moderate, 6 high), from 28.
  - Runtime, in the bundle: `@actions/http-client` (moderate), undici (high),
    `@fastify/busboy` (high). All three need `@actions/http-client` 4.x, a new
    major version (npm's fix suggestion): left for the `v1` decision.
  - Development only, not in `dist/`: `@typescript-eslint/*` and minimatch
    (high, fix in `@typescript-eslint` 8.x), `prettier-eslint` (high, 17.x),
    `jest`, `ts-jest` and their parts (low; npm suggests a `jest` downgrade).
- Prettier 3.10 rewraps two list items of this file; nothing else in the source
  changed formatting (`npm run format:check` exit 0 after `npm run bundle`).

### Follow-up tests: before and after

Before = a7a2099 sources with the new test files copied in
(`/tmp/dbs-polish/before`, ts-jest type diagnostics off so each test reports on
its own); `npx jest --coverage=false --forceExit <file>`, one file per run.

| File                      | Before (a7a2099)            | After                        |
| ------------------------- | --------------------------- | ---------------------------- |
| `__tests__/util.test.ts`  | exit 1: 2 passed, 10 failed | exit 0: 12 passed            |
| `__tests__/main.test.ts`  | exit 1: 5 passed, 1 failed  | exit 0: 6 passed (live, too) |
| `__tests__/index.test.ts` | not run (unchanged)         | exit 0: 1 passed             |

- Fail before, pass after: the 5 invalid versions (IA5), 403 and 429 (IA1), the
  network error (IA3), the token sent with the lookup (IA1), and the missing
  archive (IA2).
- Fails before for a weaker reason: "latest without a token asks GitHub
  anonymously". The old code was anonymous too; the test fails only because it
  called the client without a headers argument.
- Pass before and after (guards): the 2 pinned versions in `util.test.ts`; in
  `main.test.ts` the pinned install (now also: no token on downloads), the 3
  checksum failures and the live `latest` test.
- The first run of `__tests__/main.test.ts` after the change failed the live
  test: it sent the fake test token to the real API. Fixed by asking anonymously
  in that test.

### Other runs (after)

| Run                                         | Result                                                      |
| ------------------------------------------- | ----------------------------------------------------------- |
| `npm run bundle`                            | exit 0; `dist/` rebuilt (round 1, and again in round 2)     |
| `npm run lint`                              | exit 0 (both rounds)                                        |
| `npm run format:check`                      | exit 0 (both rounds)                                        |
| `npx tsc -p .github/linters/tsconfig.json`  | exit 2, TS6059: that config cannot run alone (pre-existing) |
| markdownlint-cli 0.41.0, readme + this file | 1st: readme 0, this file 4 duplicate headings; rerun exit 0 |
| textlint 14 + terminology, same files       | 1st: readme 0, this file 4 terms; rerun exit 0              |

- `tsc`: the linters' tsconfig extends the root one, whose `rootDir` is `./src`,
  and adds `__tests__`. ESLint only uses it for parsing, and ts-jest type-checks
  each test file (all compiled), so I left it.

### Follow-up end-to-end: built `dist/index.js` on alfa (Linux arm64)

Round 2 (after the dependency updates, 23:36–23:37Z) repeated the three test
files, one per run: `util.test.ts` 12 of 12, `main.test.ts` 6 of 6 (live test
too), `index.test.ts` 1 of 1, each exit 0. The end-to-end runs below gave the
same results in both rounds.

`/tmp/dbs-polish/e2e.sh`: per version, `INPUT_VERSION=$v INPUT_TOKEN=`
(anonymous)
`RUNNER_TEMP=… RUNNER_TOOL_CACHE=… GITHUB_PATH=… node dist/index.js`, then the
agent's `--version` from the path it added.

| `version` | Result                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `latest`  | ✅ v2.9.0, `Verified SHA-256 of dbsnapper_2.9.0_linux_arm64.tar.gz`, exit 0, agent 2.9.0                     |
| `v2.9.0`  | ✅ verified, exit 0, agent 2.9.0                                                                             |
| `2.7.1`   | ✅ verified, exit 0, agent 2.7.1                                                                             |
| `2.9`     | ✅ refused: `Invalid version "2.9": use latest or a version number such as 2.9.0`, exit 1, nothing on `PATH` |

### Follow-up decisions

- Token default `${{ github.token }}` rather than empty: every workflow has it,
  and it lifts the anonymous limit with no setup. It goes only to
  `api.github.com`; the release files are public and need none.
- 403 and 429 both named as the rate limit: GitHub answers a spent limit with
  either. A 403 for another reason gets the same hint, which still points at the
  fix (pin a version).
- IA5 done, since it is one pattern and a test.
- ts-standard switched off instead of configured: the repository already lints
  TypeScript with ESLint (its own rules) and Prettier, in CI and in
  super-linter.
- Dependabot round 1 kept to the 3 open alerts, as the handoff says; round 2
  took every direct dependency to the newest version within its major, as
  decided.

### Open items (follow-up)

- **`@actions/http-client` 4.x** (for the `v1` decision): it fixes the three
  runtime advisories left (undici and `@fastify/busboy` high,
  `@actions/http-client` moderate) [INFERENCE: npm's fix suggestion]. The action
  downloads only from GitHub over HTTPS, so those undici advisories (fetch
  decompression, WebSocket, Set-Cookie, `upgrade`) are low exposure here
  [INFERENCE: read from the advisory titles]. `@actions/core` 3.x and
  `@actions/tool-cache` 4.x are the matching majors (`npm outdated`).
- **Development-tool advisories** (15 of the 18): `@typescript-eslint` 8.x and
  `prettier-eslint` 17.x are new majors [INFERENCE: likely ESLint 9
  configuration changes, not tried]; not in the bundle.
- **CI not run** (GitHub minutes capped until 12-01): `check-dist`,
  `Continuous Integration` and `Lint Codebase` run on the next push to `main`.
- **Release** (Joe's call): a new tag and moving `v1`.
- **IA7, IA8, IA9** from the second review
  (`reports/review-dbs-install-action-polish.md`): not in this round, as the
  conductor ordered.

### Fix after review (IA6)

State on 2026-11-15 06:00Z: done, waiting for review. Review
`reports/review-dbs-install-action-polish.md` (verdict "merge: after IA6").

- **What was wrong:** the `token` default was `${{ github.token }}` on every
  GitHub server. On a GitHub Enterprise server that is the server's own job
  token, which `api.github.com` refuses (HTTP 401), so the default
  `version: latest` would fail on every run there [INFERENCE: reviewer's
  finding; no Enterprise server to test on]. Before this branch the lookup was
  anonymous and worked there.
- **Fix in `action.yml`:** the default is now
  `${{ github.server_url == 'https://github.com' && github.token || '' }}`, the
  expression `actions/setup-node`, `setup-go` and `setup-python` use (per the
  review's detail). On github.com: the job token, as before. Anywhere else: an
  empty token, which the action already treats as an anonymous lookup (✅
  `main.test.ts` live test with `token: ''`, and the end-to-end runs above with
  `INPUT_TOKEN=`). The input's description says so.
- **`README.md`** ("Token for `latest`"): the default applies on github.com; on
  an Enterprise server pass a github.com token as `token`, or pin `version`.
- **No code change, no rebuild:** `git status --short` lists only `action.yml`,
  `README.md` and this file; `dist/` is untouched, so it still equals the fresh
  build the review checked (4 of 4 files byte-identical at 4654633).

Check of the expression (documented check, not a permanent test): the script
below reads `inputs.token.default` from `action.yml` and evaluates it with
GitHub's own expression evaluator, `@actions/expressions` 0.3.61 (npm, the
package behind the Actions language service), with a stand-in job token.

```js
// /tmp/dbs-polish/ia6/check.mjs; npm install @actions/expressions@0.3.61 yaml
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { Lexer, Parser, Evaluator, data } from '@actions/expressions'

const raw = parse(readFileSync(process.argv[2], 'utf8')).inputs.token.default
const expr = /^\$\{\{(.*)\}\}$/s.exec(raw.trim())[1]
const TOKEN = 'job-token-placeholder'
const cases = [
  ['https://github.com', TOKEN],
  ['https://ghe.example.com', ''],
  ['https://acme.ghe.com', ''],
  ['http://github.com', '']
]
let bad = 0
for (const [serverUrl, want] of cases) {
  const ast = new Parser(new Lexer(expr).lex().tokens, ['github'], []).parse()
  const ctx = new data.Dictionary({
    key: 'github',
    value: new data.Dictionary(
      { key: 'server_url', value: new data.StringData(serverUrl) },
      { key: 'token', value: new data.StringData(TOKEN) }
    )
  })
  const got = new Evaluator(ast, ctx).evaluate().coerceString()
  if (got !== want) bad++
  console.log(
    got === want ? 'ok  ' : 'FAIL',
    serverUrl,
    '->',
    got === TOKEN ? 'job token' : JSON.stringify(got)
  )
}
process.exit(bad ? 1 : 0)
```

| `github.server_url`              | Before (4654633) | After        |
| -------------------------------- | ---------------- | ------------ |
| `https://github.com`             | ✅ job token     | ✅ job token |
| `https://ghe.example.com`        | ❌ job token     | ✅ `""`      |
| `https://acme.ghe.com` (tenant)  | ❌ job token     | ✅ `""`      |
| `http://github.com` (look-alike) | ❌ job token     | ✅ `""`      |
| exit code                        | 1 (1 of 4)       | 0 (4 of 4)   |

- Run once on the edited `action.yml` and once on `git show 4654633:action.yml`.
  The evaluator is the language service's, not the runner's; that the runner
  computes the same is [INFERENCE: same expression language, and the three
  official setup actions ship this default].
- Prettier moved the default onto its own line (a plain YAML scalar, same value:
  the script parses the file and prints the one-line expression).

Runs after the fix:

| Run                                                              | Result                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| expression check above, after                                    | exit 0, 4 of 4                                             |
| `npm run format:check` (after `prettier --write` on the 2 files) | exit 0                                                     |
| markdownlint-cli 0.41.0, `README.md` and this file               | exit 0                                                     |
| textlint 14 + terminology, `README.md` and this file             | exit 0                                                     |
| lines over 80 characters in `action.yml` (`awk`)                 | 0 (the yamllint limit; yamllint itself not installed here) |

- Not run: tests and the bundle (no code changed), the action on a real
  Enterprise server (none available), CI (no push).

## Follow-up: dbs-install-action-majors

Branch `dbs-install-action-majors` from `main` 887639a (= release `v1.1.0`).
Handoff `handoff/dbs-install-action-majors.md` (clonit-meta 631a840), decision
`install action: v1 on 2.x, majors next` (Joe, 2026-11-15). Findings IA7–IA9
from `reports/review-dbs-install-action-polish.md`. No push, no tag, no release.

Legend:

- **Runtime** = code in the bundle `dist/index.js`, which runs in users' jobs;
  **development** = lint, test and build tools only.
- **ESM-only** = a package that can only be loaded with `import`, not with
  CommonJS `require()`.
- ✅ done and checked · ❌ not done (reason given) · [INFERENCE] = read, not
  run.

State on 2026-11-15 (times in the tables): done, waiting for review. Every run
below ran on alfa (Linux arm64) with Node 24.22.3 (mise), under
`flock /tmp/dbs-heavy.lock nice -n 19`, one at a time; each started at load1 <
16 and memory PSI avg60 < 1, except one `npx jest` at 17:24Z that started at
load1 18.1 (my mistake; I added a load check in front of every later run).

### Majors changes

| Area                      | Before                    | After                                          |
| ------------------------- | ------------------------- | ---------------------------------------------- |
| `@actions/core`           | 1.11.1                    | 3.0.1                                          |
| `@actions/http-client`    | 2.2.3 (undici 5.29.0)     | 4.0.1 (undici 6.29.1)                          |
| `@actions/tool-cache`     | 2.0.2                     | 4.0.0 (`@actions/exec` 3, `io` 3)              |
| `action.yml` `runs.using` | `node20`                  | `node24` (IA9)                                 |
| `.node-version` (CI)      | 20.6.0                    | 24.22.3 (newest 24.x, 2026-11-10)              |
| `package.json` engines    | `>=20`                    | `>=24`                                         |
| devcontainer image        | `typescript-node:20`      | `typescript-node:24`                           |
| `@types/node`             | 20.19.43                  | 24.19.2                                        |
| `@typescript-eslint/*`    | 7.18.0                    | 8.72.2                                         |
| HTTP 401 on the lookup    | `… answered HTTP 401`     | `… GitHub refused the token. Pin a …` (IA7)    |
| Tag GitHub answers        | used as is                | same format check as `version` (IA8)           |
| JSON `null` answer        | raw `Cannot read …` error | `Failed to resolve …: … returned no tag` (IA8) |

- **IA7** (`src/util.ts`): a 401 when a token was sent says

  ```text
  … answered HTTP 401: GitHub refused the token. Pin a version (version: 2.9.0) to skip this lookup, or pass a valid token (token input)
  ```

  A 401 without a token (not expected from GitHub) keeps the plain message. The
  readme section "Token for `latest`" says the same.

- **IA8** (`src/util.ts`): the answer's `tag_name` is typed `unknown`; a
  missing, `null` or non-string tag fails with `returned no tag`, and a tag that
  does not match `VERSION_PATTERN` (the `version` input's pattern) fails with
  `returned the tag "…", which is not a version number`, before any download.
  The token mask (`core.setSecret`) the review also suggested is not in the
  handoff: ❌ not done.
- **ESM-only packages.** `@actions/core` 3, `http-client` 4 and `tool-cache` 4
  are ESM-only (their `package.json`: `"type": "module"`, exports with only an
  `import` condition). What that needed here:
  - `tsconfig.json`: `module: preserve`, `moduleResolution: bundler` (was
    `NodeNext`). ncc failed with `Package path . is not exported` before; now
    TypeScript keeps the `import`s and ncc (webpack) resolves them. `src/`
    imports unchanged; the bundle is still one CommonJS `dist/index.js`.
  - Jest (CommonJS): `script/jest-resolver.cjs` resolves `@actions/*`, and only
    those, with the `import` condition, and `package.json` lets ts-jest turn
    their files into CommonJS (`transformIgnorePatterns`, a `.js` transform).
    Asking for `import` for every package broke Jest's own `dedent` (an `.mjs`).
    No test needed a change for this.
  - ❌ Not chosen: making the whole project ESM (`"type": "module"`), as
    GitHub's current action template does. Tests spy on `core`, `tc` and `os`
    with `jest.spyOn`, which ESM namespaces do not allow; they would all move to
    `jest.unstable_mockModule`.
- **`@typescript-eslint` 8:** 3 rules the config named were removed in v8
  (`func-call-spacing`, `semi`, `type-annotation-spacing`, all layout rules that
  Prettier enforces); I took them and the already-`off`
  `space-before-function-paren` out of `.github/linters/.eslintrc.yml`. 0
  changes in `src/` or `__tests__/` for lint (`npm run lint` exit 0). The second
  generation of these packages that `eslint-plugin-github` brought is gone:
  `npm ls @typescript-eslint/parser` shows 8.72.2 once, plus 6.21.0 under
  `prettier-eslint`.
- **Jest did not exit (found here, also on `main`).** The live `latest` test
  sends a HEAD request and never read the response, so its socket kept Jest
  alive: `npx jest __tests__/main.test.ts` printed `Jest did not exit` and was
  stopped by `timeout 90` (exit 124) on a clean copy of 887639a too (Node
  24.22.3), and a 6-line script with only that HEAD request hung the same way
  until it read the body (then exit 0 in 302 ms). The test now reads the body.
  CI runs `npx jest` without `--forceExit`, so on the next push the `Test` step
  would have hung [INFERENCE: not run on GitHub].

What changed in the three runtime packages, from their `RELEASES.md` (toolkit
`main`) and a diff of the published `lib/` files, old against new:

| Package (old → new)                      | Changes                                                                                                                                                              | Effect on this action                                                                                                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http-client` 2.2.3 → 4.0.1              | 3.0.0 Node 24 support; 3.0.1 adds `actions_orchestration_id/<id>` to the user agent when `ACTIONS_ORCHESTRATION_ID` is set; 3.0.2 and 4.0.1 undici 6; 4.0.0 ESM-only | User agent of the lookup and downloads gains that suffix on runners that set the variable [INFERENCE]; proxy, redirect and retry code: 0 changed lines in the diff besides header number-to-string handling |
| `core` 1.11.1 → 3.0.1                    | 2.0.0 Node 24, http-client 3; 3.0.0 ESM-only; 3.0.1 undici bump                                                                                                      | `getInput`, `info`, `addPath`, `setFailed`: unchanged in the diff                                                                                                                                           |
| `tool-cache` 2.0.2 → 4.0.0               | 3.0.0 core 2, exec 2, http-client 3, io 2 (`semver` 6 → 7); 4.0.0 ESM-only                                                                                           | `downloadTool` (3 tries, retries on 5xx, 408, 429), `extractTar`, `HTTPError`: unchanged in the diff; `cacheDir`/`find` not used (0 calls in `src/`)                                                        |
| `exec` 1.1.1 → 3.0.0, `io` 1.1.3 → 3.0.2 | ESM; `io` restores Node 20 `readlink` results for Windows junctions                                                                                                  | `tar` call unchanged; Windows not supported by the action                                                                                                                                                   |

- The bundle's package list (`dist/licenses.txt`): `@fastify/busboy` gone, none
  added (8 packages left). Hosts in `dist/index.js`: 1 new address, in a comment
  of undici's multipart parser (`andreubotella.github.io`), 2 old ones gone; no
  new host is contacted [INFERENCE: comment only].
- `npm audit`: 3 runtime advisories → 0. The undici code the review found
  uncalled (proxy helper) is still in the bundle and still uncalled [INFERENCE:
  not re-read].

### `npm audit` before and after

`npm audit --package-lock-only`, on 887639a and on the working tree:

| Scope                  | Before (887639a)               | After                          |
| ---------------------- | ------------------------------ | ------------------------------ |
| Runtime (`--omit=dev`) | 3 (2 high, 1 moderate)         | **0**                          |
| All (runtime + dev)    | 18 (6 high, 5 moderate, 7 low) | 15 (4 high, 4 moderate, 7 low) |
| Development only       | 15                             | 15                             |

Left, all development:

- **minimatch chain (8 entries: `@typescript-eslint/*` 5, `typescript-eslint`,
  minimatch, `prettier-eslint`):** ❌ not fixable by a major. The advisory needs
  minimatch ≥ 11.0.1; the newest `@typescript-eslint/typescript-estree` (8.72.2,
  also the newest 8.x and `latest`) asks for `^10.2.2`, so npm's only "fix" is a
  downgrade to 6.15.0. Only an `overrides` entry forcing minimatch 11 would
  clear it (the parser calls minimatch only for `projectService`, which this
  config does not use [INFERENCE: read in `typescript-estree`]). Not done: a pin
  outside the dependent's range, for a ReDoS in a lint tool fed by our own
  patterns.
- **`prettier-eslint` 16 → 17:** ❌ left. 17.1.3 brings its own ESLint 10 and
  `@typescript-eslint/parser` 8 (still flagged through minimatch, as above), so
  the count would not drop. No script uses it; only the devcontainer's Visual
  Studio Code extension `rvest.vs-code-prettier-eslint` names it.
- **Jest chain (7 low):** unchanged; npm proposes Jest 25 (a downgrade).

### Majors tests: before and after

| Run (Node 24.22.3)                                               | Result                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| After, `timeout 150 npx jest` (3 files, CI's command), 17:30Z    | exit 0: 26 passed, 0 failed; Jest exited by itself          |
| Clean copy of 887639a, `npx jest __tests__/main.test.ts`, 17:19Z | 6 passed, then `Jest did not exit`, exit 124 (`timeout 90`) |
| 887639a sources + the new `util.test.ts`, 17:31Z                 | exit 1: 12 passed, 7 failed (the 7 new tests: IA7 1, IA8 6) |
| `npm run lint`                                                   | exit 0                                                      |
| `npm run format:check`                                           | exit 0                                                      |
| `npx tsc --noEmit -p .`                                          | exit 0                                                      |
| `npm run bundle`                                                 | exit 0; `dist/` rebuilt (4 files)                           |

- New tests: `util.test.ts` 401 (1), latest tag not a version number (5 tags:
  `release-3`, `vv2.9.0`, `../x`, `v2.9.0/../../x`, `v2.9.0?x`), JSON `null`
  (1).
- Coverage after: `src/` 94.56 % of statements (`util.ts` 95.55 %).

### Majors end-to-end: built `dist/index.js` on alfa (Linux arm64)

`/tmp/dbs-iam/e2e.sh`, as in the polish round: per case a fresh directory,

```text
env -i … INPUT_VERSION=$v INPUT_TOKEN=… RUNNER_TEMP=… RUNNER_TOOL_CACHE=… GITHUB_PATH=… node dist/index.js
```

(Node 24.22.3), then the agent's `--version` from the path the action added.
17:31–17:38Z.

| `version` (token)        | Result                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `latest` (none)          | ✅ v2.9.0, `Verified SHA-256 of dbsnapper_2.9.0_linux_arm64.tar.gz`, exit 0, agent 2.9.0 (twice)      |
| `v2.9.0` (none)          | ✅ verified, exit 0, agent 2.9.0                                                                      |
| `2.7.1` (none)           | ✅ verified, exit 0, agent 2.7.1 (2nd run, 17:38Z; 1st run: see below)                                |
| `2.9` (none)             | ✅ refused: `Invalid version "2.9": …`, exit 1, nothing on `PATH`                                     |
| `latest` (made-up token) | ✅ `… answered HTTP 401: GitHub refused the token. Pin a version …`, exit 1, nothing downloaded (IA7) |

- **1st `2.7.1` run (17:31Z):** the archive request stalled; after 3 minutes
  `Request timeout: …`, `Waiting 20 seconds before trying again`, the 2nd try
  downloaded, verified and unpacked it (agent 2.7.1 on `PATH`). The retry works
  with the new `tool-cache`. But the process did not exit: still running 2
  minutes after the install, holding one connection to GitHub in `FIN-WAIT-1`
  (`ss -tnp`); I stopped it (`kill <pid>`, exit 143). See open items.

### Majors decisions

- `@actions/http-client` 4.x as the handoff says, although 3.0.2 (with `core`
  2.0.3 and `tool-cache` 3.0.1, still CommonJS) also clears the 3 runtime
  advisories (npm's range for http-client is `2.2.0 - 3.0.1`). The 2.x/3.x line
  gets no more releases (newest 2026-01-27), and the ESM switch is a config
  change here, not a code change.
- Keep the project CommonJS with bundler resolution and a small Jest resolver,
  rather than converting it to ESM (reason above).
- `.node-version` set to the exact newest 24.x (24.22.3), not `24`: same style
  as before, and the bundle build stays reproducible.
- The 401 hint only when a token was sent: an anonymous request has no token to
  blame.
- Took the `@typescript-eslint` 8 major: no lint churn in `src/`, one fewer copy
  of the lint stack. Left `prettier-eslint` and minimatch (above).

### Open items (majors)

- **Step can hang after a stalled download** (new, LOW, also on `main`
  [INFERENCE: the timeout code in `http-client` has 0 changed lines between
  2.2.3 and 4.0.1]): on a request timeout `http-client` ends the socket but does
  not destroy it, so a dead connection keeps Node running until the kernel gives
  up on it (about 15 minutes with Linux defaults [INFERENCE]), and the step with
  it. Fix options: `process.exit()` after `run()` in `src/index.ts`, or a
  shorter `socketTimeout`; 30 min [estimate: one line, one test, rebuild].
- **Token mask** (`core.setSecret`, review IA8): not in this handoff.
- **minimatch override** (8 dev advisories): Joe's call, see above.
- **CI not run** (no push): `check-dist`, `Continuous Integration` and
  `Lint Codebase` run on the next push to `main`, on Node 24.22.3 now.
- **Release** (Joe's call): users get this only when `v1` moves.

### Status (majors, 2026-11-15 17:45Z)

- Work commit `14f9021` on `dbs-install-action-majors` (parent 887639a); this
  status note is the commit after it. Not pushed, no tag, no release.
- `dist/` equals a fresh build: a clone of `14f9021` in `/tmp`, `npm ci` (594
  packages, exit 0) and `npm run bundle` (exit 0), 17:44Z: 4 of 4 files
  byte-identical to the committed ones (`cmp`), clone clean afterwards (0 lines
  in `git status --short`); `dist/index.js` SHA-256 starts `22b0106e4d8719bb`.
- Ran: the 3 test files (26 passed), lint, format check, `tsc`, bundle,
  `npm audit` before and after, end-to-end runs of the bundle for 5 cases (table
  above). Privacy scan (`private-terms.ere`) and key-format scan: 0 and 0 on
  every changed file except the bundle, where the plain `AKIA` substring appears
  in base64 WebAssembly (2 lines in `index.js`, 1 in the map; 1 line before);
  the full key pattern `AKIA[0-9A-Z]{16}` counts 0.
- Not run: CI on GitHub (no push), the Mac gates (the conductor's).
- Left: open items above.

### Fixes after the review stop (majors)

Conductor's decisions on the stop at `eaa6d76`: (1) fix the stalled download
now, (3) mask the token, (2) leave the minimatch pin and `prettier-eslint` 17
for Joe; keep the Jest hang fix on this branch.

- **(1) Stalled download** (the open item above). `src/download.ts` replaces
  `tc.downloadTool` for the archive and `checksums.txt`; `tool-cache` is still
  used for `extractTar`.
  - One timer per attempt, restarted by every chunk received. After 30 s without
    data it destroys the attempt's connections (`HttpClient.dispose()`, which
    destroys the client's own agent, and the response stream) and the attempt
    fails with `download stalled: no data for 30 seconds`. The client is
    disposed after every attempt, success or not, so no socket stays behind.
  - Retries as `tool-cache` did: 3 attempts, 10 s apart, no retry on an HTTP
    status below 500 other than 408 and 429; a partial file is deleted. Worst
    case for a dead connection: about 2 minutes (3 × 30 s + 2 × 10 s), then the
    step fails with

    ```text
    Failed to download dbsnapper_…tar.gz from <url>: download stalled: no data for 30 seconds (3 attempts)
    ```

    `checksums.txt` failures keep their `Cannot verify …` message.

  - The same `http-client` timeout also applies to the `latest` lookup; that
    client is now disposed after its one request too.
  - Behind a proxy `http-client` uses a tunnel agent that `dispose()` does not
    destroy: a stall mid-file is still cut (the response stream is destroyed), a
    stall before the answer ends with `http-client`'s own timeout (35 s here)
    and may leave that one half-closed socket [INFERENCE: read in `http-client`,
    no proxy to test with].
  - Before, for the record: `tc.downloadTool` (tool-cache 4.0.0) against a local
    server that stops after 5 of 100 bytes had not settled after 45 s (throwaway
    script `/tmp/dbs-iam/stall-probe.mjs`, `timeout 45`, exit 124, "still
    waiting" at 10, 20, 30 and 40 s).
- **(3) Token mask:** `core.setSecret(token)` when the token is not empty
  (`src/main.ts`), so a token written literally into a workflow is masked too;
  the runner already masks the job token and secrets.
- **(2) Left for Joe**, development only, nothing in the bundle: the minimatch
  `overrides` pin (8 advisories) and `prettier-eslint` 17 (no audit gain), as
  described above.
- **Jest hang** (the unread HEAD response): fixed here, also present on `main`
  (887639a), as described above.

New tests:

| Test                                                                      | What it proves                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `download.test.ts`: server stops sending before the answer / mid-file (2) | fails in < 3 s with `download stalled …(2 attempts)`, 2 requests, every server-side connection closes, no file left |
| `download.test.ts`: full answer; HTTP 404                                 | file written under `RUNNER_TEMP`; 404 fails after 1 request with its status                                         |
| `main.test.ts`: masks the token (with / without a token)                  | `setSecret` called once with the token; not called for an empty one                                                 |
| `main.test.ts`: archive download stalls                                   | the step fails with `Failed to download <archive> from <url>: download stalled …`, nothing unpacked                 |

- The download tests listen on `127.0.0.1`, port from `INSTALL_ACTION_TEST_PORT`
  (0 = the kernel picks one); on alfa I ran them on 30410 (my block).

Runs (Node 24.22.3, same load brake; one more slip: the 17:53Z run of the checks
below started at load1 16.6, the guard read the load a moment earlier):

| Run                                              | Result                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `npm run bundle`, 17:54Z                         | exit 0; `dist/` rebuilt                                                          |
| `npm run lint` / `format:check` / `tsc --noEmit` | exit 0 / 0 / 0                                                                   |
| `timeout 150 npx jest` (4 files), 17:55Z         | exit 0: 33 passed, 0 failed; Jest exited by itself; `download.ts` 100 % of lines |
| End-to-end `latest` (bundle), 17:56–17:57Z       | ✅ exit 0, agent 2.9.0, verified; see below                                      |

- The end-to-end run hit a real stall: the first archive request got no data,
  and the step logged

  ```text
  Downloading https://github.com/…/dbsnapper_2.9.0_linux_arm64.tar.gz failed: download stalled: no data for 30 seconds; trying again in 10 seconds
  ```

  then the second attempt downloaded, verified and unpacked it, and the process
  exited on its own: 43 s for the whole run (17:56:23 to 17:57:06Z), against
  more than 2 minutes still running in the first-round stall.

### Status (majors, after the fixes, 2026-11-15 18:01Z)

- Work commit `d98a4f2` (stall fix, token mask, `dist/`), on `eaa6d76`; this
  status note is the commit after it. No push by me, no tag, no release.
- `dist/` equals a fresh build: a clone of `d98a4f2` in `/tmp`, `npm ci` (594
  packages, exit 0) and `npm run bundle` (exit 0), 17:58Z: 4 of 4 files
  byte-identical (`cmp`), clone clean afterwards (0 lines in
  `git status --short`); `dist/index.js` SHA-256 starts `bc761e147445a810`.
- Privacy scan and key-format scan (full patterns) on the 8 changed files: 0 and
  0 each.
- Open: the minimatch pin and `prettier-eslint` 17 (Joe); the proxy case of the
  stall fix ([INFERENCE] above); CI runs on the merge to `main`.
