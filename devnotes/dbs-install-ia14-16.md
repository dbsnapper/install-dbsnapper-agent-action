# dbs-install-ia14-16: end-of-run nits IA14–IA16, CI runs the installed agent (row 1184)

Legend: ✅ works / done · ❌ fails / not done · [INFERENCE] = not verified by a
command · [estimate] = a guess, with its basis · Z = UTC.

- **`runToEnd`** = `src/lifecycle.ts`: runs the action, waits for stdout and
  stderr to write what is queued, then ends the process.
- **Flush** = that wait: an empty write to each output stream, awaited before
  `exit()` (IA13).
- **IA14–IA16** = the NIT findings of the review of IA12/IA13 (clonit-meta
  `planning/dbsnapper-clonit-future/reports/review-dbs-install-ia12-13.md`);
  open item 4 there = the CI step.
- **Mutant** = a one-line change of the head sources that a test must catch.
- Branch `dbs-install-ia14-16` from `main` b0d2481 (= `v1` = `v1.3.0`). No push,
  no tag, no release, no workflow started.

## Summary

- ✅ **IA14:** the flush waits 10 s at most, then the process exits with the
  code the action set. On the normal path the timer is cleared at once.
- ✅ **IA15:** the failure line of a rejecting action is built so that no value
  can make it throw: `Error` → its message, string → itself, anything else →
  `util.inspect`, and a last fallback text if even that throws.
- ✅ **IA16:** 3 more lifecycle tests (slow stream second, broken and destroyed
  stream, string rejection).
- ✅ **CI:** a step after the two install steps runs `dbsnapper --version` from
  `PATH` and expects 2.7.1, the version the last install step put first.
- ✅ Jest on the head tree, alfa and Mac, Node 24.22.3: 6 suites, **54 passed, 0
  failed**; `npm run all` exit 0; a second `npm run bundle` gives the same
  bytes, identical on both hosts. The first Mac run (RIA14) had found 2 broken
  IA15 tests (52/54): a test bug, fixed in round 2 (below).

## The change

- `src/lifecycle.ts`
  - Flush: `Promise.race` of the empty writes against a 10 s timer
    (`FLUSH_LIMIT_MS`, module constant), then `clearTimeout`, then `exit()`.
  - Failure line: `describe(error)` (see IA15 above) instead of a template
    string over `error.message : error`.
    - ✅ `'boom'` (an `Error`) and `'plain string'` keep their text as before;
      an object now shows its fields (`{ code: 'E1' }`) instead of
      `[object Object]`.
- `__tests__/lifecycle.test.ts`: fake timers for the whole file
  (`process.nextTick` and `setImmediate` stay real: streams call back through
  them); 6 new tests (4 `test` and a 2-row `test.each`) plus 1 assertion (table
  below).
- `.github/workflows/ci.yml`: step `Run Installed Agent` (`shell: bash`, so
  `-e -o pipefail`); the second install step's name says "Specific Version" (it
  said "Latest Version" twice).
- `dist/`: rebuilt by `npm run all` on alfa (Node 24.22.3); `dist/index.js`
  `cdf6b4a4…f7047`, `dist/index.js.map` `79d59b9d…4390`, the same bytes as the
  Mac's bundle of the same sources in RIA14.

## Tests

### New tests and what each one kills

| Test (`__tests__/lifecycle.test.ts`)                            | Rule                             | Fails on                                       |
| --------------------------------------------------------------- | -------------------------------- | ---------------------------------------------- |
| ends the process…: `jest.getTimerCount()` is 0 (new assertion)  | IA14: timer cleared, normal path | `m2-timer-kept`                                |
| a reader that stays alive but never reads holds the end ≤ 10 s  | IA14: the limit, 10 s exactly    | base b0d2481, `m3-limit-1s`, `m5-race-streams` |
| a rejection with a Symbol: exit code 1 and the `::error::` line | IA15                             | base b0d2481                                   |
| same with an object without a prototype                         | IA15                             | base b0d2481                                   |
| a rejection that is a string fails the step with that string    | IA16: no quotes around a string  | `m8-inspect-all`                               |
| ends only after every output stream has written, not the first  | IA16: every stream is awaited    | `m4-first-stream`, `m5-race-streams`           |
| a broken or a destroyed output stream does not keep it running  | IA16: an error still ends        | `m6-ok-only`                                   |

Mutants (one change each, patches in the Mac job):

| Mutant            | Change in `src/lifecycle.ts`                                         |
| ----------------- | -------------------------------------------------------------------- |
| `m2-timer-kept`   | `clearTimeout(limit)` removed                                        |
| `m3-limit-1s`     | `FLUSH_LIMIT_MS = 1_000`                                             |
| `m4-first-stream` | `[output[0]].map(` (the review's m3)                                 |
| `m5-race-streams` | `Promise.race(` for the inner `Promise.all(` (the review's m4)       |
| `m6-ok-only`      | `stream.write('', err => { if (!err) resolve() })` (the review's m8) |
| `m8-inspect-all`  | `error instanceof Error ? error.message : inspect(error)`            |

- The Symbol and null-prototype tests run the real `core.setFailed`: they read
  `process.exitCode` and keep every stdout write in their own array (the `write`
  spy pushes to it), then put `process.exitCode` back.
- The 10 s is a literal in the test (`9_999`, then `1`), not the module's
  constant: a test that read the constant would pass with any limit.

### Jest (round 2, alfa)

Run on alfa under the conductor's narrow exception for this fix round: a local
clone at b0d2481 + the head patch (`/tmp/dbs-install-ia14-16/ria`),
`nice -n 19 mise exec node@24.22.3`, npm 11.19.1. `git write-tree` of the 3
staged files: round 1 `d6fe055f` (= the Mac's RIA14 tree), round 2 `401721cd`.

| Run                                                       | Result                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A: round 1, `npm ci && npm run all` (23:24:03Z–23:24:44Z) | ❌ exit 1, 2 failed / 52 passed; both IA15 tests `Received: Array []` (as RIA14)      |
| B: round 2, `npm ci && npm run all` (23:25:06Z–23:25:45Z) | ✅ exit 0, 6 suites, **54 passed / 54**, 0 `✕`, ESLint clean                          |
| `npm run bundle` after B                                  | ✅ exit 0, `sha256sum -c` of the 4 `dist/` files: 4 × `OK`                            |
| base b0d2481 `src/lifecycle.ts`, `lifecycle.test.ts` only | ✅ 3 failed / 7 passed: Symbol and null prototype (`TypeError`), never-reading reader |
| `m2-timer-kept`                                           | ✅ 1 failed: ends the process… (`getTimerCount` 1, expected 0)                        |
| `m3-limit-1s`                                             | ✅ 1 failed: never-reading reader                                                     |
| `m4-first-stream`                                         | ✅ 1 failed: every output stream, not only the first                                  |
| `m5-race-streams`                                         | ✅ 3 failed: queued output (IA13), every output stream, never-reading reader          |
| `m6-ok-only`                                              | ✅ 1 failed: broken or destroyed stream                                               |
| `m8-inspect-all`                                          | ✅ 1 failed: string rejection (received `'plain string'` with quotes)                 |

- Base and mutants: one Jest run each, 23:26:10Z–23:26:48Z; `src/` back to the
  head after the loop (`git diff --quiet -- src`).
- The Mac rerun job with these counts as expected values:
  `~/private/dbs-conductor/dbs-install-ia14-16-mac2/` (round 2 `head.patch`;
  `base.patch` and the 6 mutant patches byte-identical to round 1).

### Jest (round 2, Mac: RIA14B)

The conductor's Mac run of that job (`~/.local/state/alfa-app/mac/RIA14B.out`,
sha256 `42f86038…`, 23:31:20Z–23:31:44Z): Node 24.22.3, npm 11.19.1, tree
`401721cd` (as on alfa). Every expected value met, no Jest rerun:

| Step                            | RIA14B                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1: `npm ci && npm run all`      | ✅ exit 0, 6 suites, **54 passed / 54**, 0 `✕`, 0 ESLint errors                                                                    |
| 2: `npm run bundle` again       | ✅ exit 0, `dist/index.js` and `.map` `OK`; all 4 `dist/` hashes equal alfa's (`cdf6b4a4…`, `79d59b9d…`, `ac5e612d…`, `c2a14a81…`) |
| 3: base `src/lifecycle.ts`      | ✅ 3 failed / 7 passed: Symbol, null prototype, never-reading reader                                                               |
| 4: `m2`, `m3`, `m4`, `m6`, `m8` | ✅ 1 failed / 9 passed each, its target test only                                                                                  |
| 4: `m5-race-streams`            | ✅ 3 failed / 7 passed: queued output (IA13), every output stream, never-reading reader                                            |

#### Why round 1 predicted 54 passed and got 52

- ❌ The TypeScript tests had never run before RIA14: no Jest on alfa in round
  1. The 54 came from a plain-Node replay of their logic (below).
- The bug was in the test, not in `src/`: it read `stdout.mock.calls` **after**
  `stdout.mockRestore()` in its `finally`, and Jest's `mockRestore()` also
  clears `mock.calls`. The array was always empty; the exit-code check before it
  passed (run A's log: only the `toEqual` on the lines fails).
- My replay caught stdout with a hand-made array instead of a Jest spy, so it
  could not show this. Not Node: RIA14 and run A both used 24.22.3.
- Fix (round 2, test file only): the spy's implementation pushes each write to
  its own array, which `mockRestore()` does not touch.

### Logic check on alfa (round 1, before Jest; not proof)

- The logic of 9 lifecycle checks (3 of the 4 old tests: end, IA12 rejection,
  IA13 order; and the 6 new ones) replayed in plain Node 26.13.1 with type
  stripping, a hand-made fake clock and a switchable `setFailed`
  (`/tmp/dbs-install-ia14-16/emul/emul.mts`, about 21:50Z, 5 s): head 9/9 pass;
  each variant fails exactly these checks:

| Variant           | Failing checks                                            |
| ----------------- | --------------------------------------------------------- |
| head              | none                                                      |
| base b0d2481      | Symbol, null prototype, never-reading reader              |
| `m2-timer-kept`   | ends + no timer left                                      |
| `m3-limit-1s`     | never-reading reader                                      |
| `m4-first-stream` | slow stream second                                        |
| `m5-race-streams` | queued line first (IA13), slow stream second, never-reads |
| `m6-ok-only`      | broken + destroyed                                        |
| `m8-inspect-all`  | string (and the IA12 `Error` check passes)                |

- This checked the test logic, not the TypeScript tests themselves, and it
  missed the `mockRestore()` bug above.
- `tsc` (src, and src + tests via `.github/linters/tsconfig.json`), ESLint and
  Prettier on the 3 changed files: exit 0 each (tools from an existing
  `node_modules` whose `package-lock.json` has the same SHA-256 as this
  branch's, `6b40bdb6…`; no install).

### Real process: a reader that never reads

- The review's IA14 case through the real end of a process: 200,000 bytes
  written to stdout, then `core.setFailed('failed')`, `runToEnd` with the real
  `process.exit()`; stdout a pipe into `sleep 15` (alive, never reads);
  coreutils `timeout 14` on node. Node 24.22.3 (the runner's `node24`),
  21:56:45Z, one run each:

| Tree         | Result                                                    |
| ------------ | --------------------------------------------------------- |
| head         | ✅ `exit` event at 10,004 ms, node exit status 1          |
| base b0d2481 | ❌ no `exit` event, node killed by `timeout` (status 124) |

- Normal path, same probe with a reader that reads (`wc -c`; Node 26.13.1,
  21:52Z): ✅ exit 1 at 7 ms, 200,017 of 200,017 bytes. The limit costs nothing
  when the output goes out.
- A trap for whoever probes this next: the session shell's own `timeout` builtin
  reported status 124 for a node that had already exited (`/proc/<pid>/status`
  showed it as a zombie, not reaped). Only coreutils `/usr/bin/timeout` gives
  node's real status; the table uses it.

### CI step

- ✅ The released v2.7.1 archive for linux arm64 (downloaded from the public
  release, `sha256sum -c` against its `checksums.txt`: OK), run with an empty
  environment: `dbsnapper --version` prints
  `DBSnapper Agent - Version: 2.7.1 (aab3b1292b3e) Build Date: 2024-06-08T18:52:54Z`,
  exit 0, no config directory created (cobra prints the version before the
  agent's initializers run).
- ✅ The step's `grep` on that line: exit 0; on `… Version: 2.9.0 (x)`: exit 1.
- [INFERENCE] the x64 archive the runner gets prints the same line (same
  release, same goreleaser build); proven only by the first CI run on `main`.

## Decisions (made in this task)

- **10 s, a module constant, no input.** The handoff's number. A reader that
  reads took 200 kB in 7 ms (probe above); the action writes under 1 kB, so 10 s
  only ever cuts a reader that has stopped.
- **`clearTimeout`, no `unref()`.** Clearing covers the normal path and a test
  pins it; `unref()` would add a second, untested rule. If the flush hangs, the
  timer firing is the point.
- **Strings keep their text, other values go through `util.inspect`.**
  `inspect('x')` adds quotes; the string test pins the old text.
- **CI checks the version, not only the exit code.** It proves the binary ran
  and that the later install wins on `PATH`.
- **Test name fix in `ci.yml`** ("Specific Version"): one word, the step I added
  follows it.

## Open items

- The Mac gate on the merged tree (`make check` / pre-release; conductor).
- First CI run on `main` after the merge: the new step (alfa-app's GO).
- Moving `v1`, a release: Joe.

## Status

- Commits on branch `dbs-install-ia14-16`, on `b0d2481` (origin/main at commit
  time): `d923a757` (the change, tree `eed31374`), then this results commit (its
  sha is in the `commit` message: a commit cannot name itself). No push, no tag,
  no release, no workflow started.
- Changed files in `d923a757` (`git show --stat`): `src/lifecycle.ts` 48 lines
  changed, `__tests__/lifecycle.test.ts` +134 lines, `.github/workflows/ci.yml`
  13 lines changed, `dist/index.js` and `dist/index.js.map` rebuilt (byte-equal
  to the alfa run's bundle, `cmp`), this report (new). Not committed:
  `badges/coverage.svg` (earlier rounds left it out too).
- Ran on alfa (2026-11-21):
  - Round 1 (about 21:30Z–21:57Z): `tsc` 2×, ESLint, Prettier on the changed
    files; the logic check (8 trees × 9 checks); the 2 real-process probes; the
    v2.7.1 `--version` run.
  - Round 2 (23:24Z–23:27Z, the conductor's exception): run A through
    `launch-slot` (queued 22:35Z–23:24Z; 41 s), then run B, the bundle check and
    the 7 Jest runs as separate commands, 39 s, 10 s and 38 s (each under the 2
    min launch-slot threshold).
- Privacy scan and key-format scan (the 4 key formats of the effort's rules
  file): 0 and 0 on the 3 changed source files, this report, and the 32 added
  lines of `dist/index.js`. `dist/index.js.map` is one line, so all of it counts
  as added: private terms 0, key formats 4, the same 4 as in b0d2481's map
  (third-party code).
- Ran on the Mac (conductor): RIA14 (round 1, 52/54) and RIA14B (round 2, every
  expected value met), section "Jest (round 2, Mac: RIA14B)".
- Left: the conductor's review stop.
