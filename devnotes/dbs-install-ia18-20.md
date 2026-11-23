# dbs-install-ia18-20: fallback-text test, CI path check, line cap (row 1205)

Legend: ✅ works / done · ❌ fails / not done · [INFERENCE] = not verified by a
command · [estimate] = a guess, with its basis · Z = UTC.

- **Failure line** = the one `::error::` line the action prints when the action
  rejects (`runToEnd` in `src/lifecycle.ts`, IA15).
- **Fallback text** = `a value that cannot be shown as text`, what that line
  shows when the rejected value cannot be turned into text.
- **IA18–IA20** = the NIT findings of the review of IA14–IA16 (clonit-meta
  `planning/dbsnapper-clonit-future/reports/review-dbs-install-ia14-16.md`).
- **Mutant** = a one-line change of the head sources that a test must catch.
- Branch `dbs-install-ia18-20` from `main` `d05f62a`. No push, no tag, no
  release, no workflow started.

## Summary

- ✅ **IA18:** a test rejects with an `Error` whose `message` getter throws and
  expects the fallback text, exit code 1 and one `exit`. It fails on mutant
  `m1-no-catch` (no `try`/`catch` around the text): Mac run RIA18.
- ✅ **IA19:** the CI step `Run Installed Agent` now fails unless `dbsnapper` on
  `PATH` is an executable file named `dbsnapper` in a directory right under
  `RUNNER_TEMP` (where the action unpacks it). The job `GitHub Actions Test`
  runs on `ubuntu-latest` and on `ubuntu-24.04-arm`.
- ✅ **IA20:** the failure line shows at most 2,000 characters of its text, then
  ` ... (cut: 2000 of N characters shown)`. The cut never splits a character
  made of two UTF-16 units. 3 tests, each failing on base `d05f62a`; `dist/`
  rebuilt on the Mac.
- ✅ Jest on the Mac (RIA18, Node 24.22.3): 6 suites, **58 passed / 58**, 0
  failed; every predicted count of the job met. No `npm ci`, Jest or bundle on
  alfa (handoff rule).

## The change

- `src/lifecycle.ts`
  - New `TEXT_LIMIT = 2_000` and `shorten(text)`: text of 2,000 UTF-16 units or
    fewer stays as it is; longer text is cut at 2,000 units, or at 1,999 when
    unit 2,000 is the first half of a pair (an emoji), and gets the mark
    ` ... (cut: <shown> of <total> characters shown)`.
  - `describe()` passes its text through `shorten()`, inside its `try`.
  - Not changed: `Error` and string texts under 2,000 characters (the 2 older
    tests pin them), the fallback text, the flush.
- `__tests__/lifecycle.test.ts`
  - A helper `failWith(value)` holds what the Symbol and null-prototype tests
    did inline: the real `setFailed`, a spy on `process.stdout.write` that keeps
    every chunk in its own array, `process.exitCode` put back in a `finally`. It
    returns the exit code, the `::error::` lines and the number of `exit` calls.
    The 2 older tests use it with the same expectations as before.
  - 4 new tests (table below).
- `.github/workflows/ci.yml`, job `test-action` (`GitHub Actions Test`)
  - `strategy.matrix.runner: [ubuntu-latest, ubuntu-24.04-arm]`,
    `fail-fast: false`, `runs-on: ${{ matrix.runner }}`. GitHub shows the job as
    `GitHub Actions Test (ubuntu-latest)` and
    `GitHub Actions Test (ubuntu-24.04-arm)`.
  - Step `Run Installed Agent`: before the version check, the path check
    (basename `dbsnapper`, parent of its directory = `${RUNNER_TEMP%/}`, `-f`,
    `-x`), with an `::error::` line naming the path when it fails.
- `dist/`: the Mac's build of these sources (RIA18 step 1, reproduced by step
  2), unpacked from its archive without the macOS `._*` files.
- `badges/coverage.svg`: as RIA18's `npm run all` wrote it (95.28% → 95.87%).

## Tests

### New tests and what each one kills

| Test (`__tests__/lifecycle.test.ts`)                           | Rule                       | Fails on                   |
| -------------------------------------------------------------- | -------------------------- | -------------------------- |
| a rejection whose message cannot be read … fallback text       | IA18: the `try`/`catch`    | `m1-no-catch`              |
| a rejection with an object with 200,000 fields … marked as cut | IA20: the cap              | base `d05f62a`             |
| a rejection with a 5 MB string … marked as cut                 | IA20: the cap              | base `d05f62a`             |
| the cut does not split a character made of two UTF-16 units    | IA20: the character border | base `d05f62a`, `m2-split` |

- Base `d05f62a` passes the IA18 test: its `describe()` already has the
  `try`/`catch` (IA15). The test pins it against a later edit that drops it.
- The 2 cap tests check the line in 2 ways:
  - its length is under `prefix + 3 × 2,100`: the runner's escaping turns `%`,
    CR and LF into 3 characters each, and `util.inspect` of an object writes
    line breaks;
  - with that escaping reversed, the text is exactly 2,000 characters plus the
    mark.
- Mutants (patches in the Mac job):

| Mutant        | Change in `src/lifecycle.ts`                                     |
| ------------- | ---------------------------------------------------------------- |
| `m1-no-catch` | `describe()` without its `try`/`catch` (the review's IA18 shape) |
| `m2-split`    | `const end = TEXT_LIMIT` (no check for the first half of a pair) |

### Checks on alfa (2026-11-22; no Jest, no install)

- `shorten()` alone in Node 26.13.1 (type stripping, a copy of the function, a
  few seconds):
  - `'a' × 1,999 + 😀 + 'b' × 10` (2,011 units) → 1,999 `a` +
    ` ... (cut: 1999 of 2011 characters shown)`;
  - `util.inspect` of a 200,000-key object (4,377,782 characters, 563 ms) →
    2,044 characters;
  - a 5,000,000-character string → 2,044 characters;
  - exactly 2,000 characters, and 1,000 emoji (2,000 units) → unchanged.
- `tsc --noEmit -p .github/linters/tsconfig.json --rootDir .` (src and tests;
  `--rootDir .` only because that config's `rootDir` is `src`): exit 0.
- ESLint (the repository's config) on the 2 changed TypeScript files: exit 0.
- Prettier 3.10.1 `--check` on the 3 changed files and this report: all
  formatted.
- These tools came from an existing `node_modules`
  (`/tmp/dbs-install-ia14-16/ria`) whose `package-lock.json` is byte-equal to
  this branch's (`cmp`); no install.

### The CI step, run locally

The step's `run:` block, cut from `ci.yml` with `awk`, run as GitHub does
(`bash --noprofile --norc -eo pipefail`) with `env -i`, fake agents (shell
scripts printing the version line) and `RUNNER_TEMP` pointing to a throwaway
directory. `shellcheck -s bash`: exit 0.

| `PATH` (first match)                               | Step exit | Why                          |
| -------------------------------------------------- | --------- | ---------------------------- |
| `$RUNNER_TEMP/u1/dbsnapper` (2.7.1), 2.9.0 behind  | 0         | path and version right       |
| same, `RUNNER_TEMP` with a trailing `/`            | 0         | `${RUNNER_TEMP%/}`           |
| `$RUNNER_TEMP/u2/dbsnapper` (2.9.0) first          | 1         | version check (as before)    |
| no `dbsnapper` at all                              | 1         | `command -v` fails           |
| a 2.7.1 outside `RUNNER_TEMP` first                | 1         | path check, `::error::` line |
| `$RUNNER_TEMP/u1/sub/dbsnapper` (one level deeper) | 1         | path check                   |
| only a non-executable `dbsnapper` in `RUNNER_TEMP` | 1         | path check (`-x`)            |
| a directory named `dbsnapper` only                 | 1         | `command -v` fails           |
| a symlink in `$RUNNER_TEMP/u5/` to the 2.7.1 agent | 0         | path under `RUNNER_TEMP`     |

- That the action puts the agent at `$RUNNER_TEMP/<uuid>/dbsnapper`: read.
  `tc.extractTar(archive)` with no destination unpacks into
  `path.join(RUNNER_TEMP, randomUUID())` (`dist/index.js` line 35810) and
  `main.ts` adds that directory to `PATH`; the archive holds `dbsnapper` at its
  top (the earlier step's `command -v dbsnapper` relies on it too).
- [INFERENCE] the runners pass: shown only by the first CI run on `main`
  (alfa-app's GO). arm64 has been proven locally before (IA14–IA16 report).

### Jest and bundle (Mac: RIA18)

The conductor's Mac run of the job
`~/private/dbs-conductor/dbs-install-ia18-20-mac/` (output `out/RIA18.out`,
sha256 `dadcda3f…`, 23:23:22Z–23:23:41Z on 2026-11-22): Node 24.22.3, npm
11.19.1, head tree `43def1cf` (as on alfa). Every expected value met, no Jest
rerun:

| Step                       | RIA18                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| 1: `npm ci && npm run all` | ✅ exit 0, 6 suites, **58 passed / 58**, 0 `✕`, 0 ESLint errors                                  |
| 2: `npm run bundle` again  | ✅ exit 0, `dist/index.js` and `.map` `OK`; `licenses.txt` and `sourcemap-register.js` unchanged |
| 3: base `src/lifecycle.ts` | ✅ exit 1, 3 failed / 11 passed: the 2 cap tests and the character test                          |
| 4: `m1-no-catch`           | ✅ exit 1, 1 failed / 13 passed: the fallback-text test                                          |
| 4: `m2-split`              | ✅ exit 1, 1 failed / 13 passed: the character test                                              |

- `dist/` and the badge from the run's archive `dist-ia18-20.tgz` (sha256
  `8036b367…`), unpacked with `--exclude='._*' --exclude='*/._*'` (0 `._` files
  left). sha256 of the unpacked files equal RIA18's step 2 lines:
  `dist/index.js` `a12cc2c3…73ba`, `dist/index.js.map` `34ce82ce…1504`,
  `licenses.txt` `ac5e612d…` and `sourcemap-register.js` `c2a14a81…` (unchanged,
  as in the IA14–IA16 bundle), `badges/coverage.svg` `d6f7b1d7…`.
- `dist/index.js`: 1,207,244 → 1,207,968 bytes, 16 added lines (the cap function
  and the `shorten(` call), 1 removed.

## Decisions (made in this task)

- **The cap is on the text, not on the escaped line.** The review's wording
  ("limit the failure line's text"). The runner's escaping of `%`, CR and LF
  happens later in `@actions/core`; capping after it would mean copying that
  escaping. Worst case the line is about 3 × 2,000 characters, still bounded.
- **Characters = UTF-16 units**, as `String.length` counts them; the only border
  rule is the pair rule (no grapheme clusters: one more rule for a NIT).
- **ASCII mark** ` ... (cut: …)`: no `…` character, so the line reads the same
  in any log viewer.
- **`util.inspect` still sees the whole value.** A 200,000-key object costs
  about 0.6 s on alfa before the cut (above). `inspect` has no option for a
  total length; the case is not reachable today (review: "latent").
- **arm64 label `ubuntu-24.04-arm`.** The repository had no arm64 label in any
  workflow (`grep -rn arm .github/workflows`: 0 before this change). The
  repository is public (`gh api repos/…`: `"visibility": "public"`), where
  GitHub's hosted arm64 runners are free [INFERENCE: GitHub's docs, not checked
  this session].
- **Matrix, not a second job:** one list, the same steps. `fail-fast: false` so
  one architecture's failure does not cancel the other's result.
- **No branch protection to rename:** `gh api …/branches/main/protection`: 404
  "Branch not protected"; rulesets: `[]`. The job's new names break no required
  check.

## Open items

- First CI run on `main` after the merge, including both `GitHub Actions Test`
  runners (alfa-app's GO): proves the path check and arm64 on real runners.
- IA22: drop `.github/linters/actionlint.yml` at the super-linter bump (its
  actionlint 1.7.1 does not know `ubuntu-24.04-arm`; known from 1.7.7).

## Status

- Head: one commit on branch `dbs-install-ia18-20` on `d05f62a` (origin/main);
  its sha is in the `review` message (a commit cannot name itself). Files:
  `src/lifecycle.ts`, `__tests__/lifecycle.test.ts`, `.github/workflows/ci.yml`,
  `dist/index.js`, `dist/index.js.map`, `badges/coverage.svg`, this report. No
  push, no tag, no release, no workflow started.
- Ran on alfa (2026-11-22, 23:1xZ): the checks of "Checks on alfa" and "The CI
  step, run locally"; after RIA18, the sha256 check of the unpacked files.
- Ran on the Mac (conductor): RIA18, every expected value met.
- Privacy scan and key-format scan (`handoff/_rules.md`): 0 and 0 on the 3
  changed source files, this report, the badge and the 16 added lines of
  `dist/index.js`. `dist/index.js.map` is one line, so all of it counts as
  added: private terms 0, key formats 4, the same 4 as in `d05f62a`'s map
  (third-party code).
- Review fix IA22 (second commit, config only): `.github/linters/actionlint.yml`
  lists `ubuntu-24.04-arm` so Lint Codebase's actionlint 1.7.1 accepts it.
- Left: the conductor's review stop.
