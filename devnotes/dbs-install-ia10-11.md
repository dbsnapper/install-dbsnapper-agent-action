# dbs-install-ia10-11: cut lookup and silent proxy fail the step (IA10, IA11)

Legend: ✅ works / done · ❌ fails / not done · [INFERENCE] = not verified by a
command · [estimate] = a guess, with its basis · Z = UTC.

- **IA10** (LOW): a connection cut in the middle of GitHub's answer to the
  `latest` lookup ended the step green, with nothing installed and no message.
- **IA11** (LOW, proxy users only): a proxy that accepts the connection and then
  stays silent held the step past the watchdog, up to the job's time limit.
- Both from the review of the majors branch: clonit-meta `planning/`
  `dbsnapper-clonit-future/reports/review-dbs-install-action-majors.md`.
- **Watchdog**: the action's own "no data for 30 seconds" limit per download
  attempt (`devnotes/dbs-install-action.md`, "Fixes after the review stop").
- Branch `dbs-install-ia10-11` from `main` 1105037 (= `v1` = `v1.2.0`). No push,
  no tag, no release, no workflow started.

## Summary

- ✅ **IA10:** a lookup answer cut mid-way fails the step:

  ```text
  Failed to resolve the latest DBSnapper Agent release: https://api.github.com/repos/dbsnapper/dbsnapper/releases/latest: the connection closed before the whole answer arrived
  ```

  Before: exit 0, no output, nothing installed.

- ✅ **IA11:** behind a proxy that never answers, each attempt ends at the
  watchdog's limit and the existing retry and failure path runs; the process
  ends by itself afterwards. The lookup now has the same 30 s limit.
- ✅ Last guard: if Node ever runs out of work before the action finished, the
  step fails instead of ending green.

## The change

- `src/watchdog.ts` (new): `withWatchdog(seconds, onStall, work)`. The work
  calls `refresh()` on every chunk; after `seconds` without one, `onStall`
  destroys what it can reach and the promise **rejects at once**, whether or not
  the work ever settles.
  - Before, the download watchdog only destroyed sockets and waited for the
    request to fail. A tunnel still waiting for its CONNECT answer is not
    reachable (`HttpClient.dispose()` destroys only the direct agent), so
    nothing failed and the attempt never ended (IA11 case 1).
- `src/download.ts`: each attempt runs under `withWatchdog`; message unchanged
  (`download stalled: no data for 30 seconds`), retries unchanged (3 attempts,
  10 s apart).
  - An answer that arrives after its attempt stalled is destroyed unread, so it
    never writes into the file path the next attempt uses.
  - This also covers IA10's second path: a redirect answer whose body stops
    (http-client reads that body itself and never settles).
- `src/util.ts`: the `latest` lookup reads the answer itself (`readAll`) instead
  of http-client's `readBody()`, which never settles when the connection closes
  early; an incomplete answer (`message.complete` false) fails with "the
  connection closed before the whole answer arrived".
  - The lookup runs under the same watchdog, 30 s: "the answer stalled: no data
    for 30 seconds". Before, a lookup had only http-client's 3-minute socket
    timer, and none at all behind a proxy waiting for CONNECT.
  - `resolveRelease(version, token, { stallSeconds })`: the third argument is
    for the tests; `main.ts` passes none.
- `src/lifecycle.ts` (new), `src/index.ts`: `runToEnd(run)`.
  - After `run()` settled: `process.exit()` with the exit code the action set
    (`core.setFailed` sets 1). A socket nobody can destroy (IA11 case 2: a proxy
    that ignores the client's close) can no longer keep the step running after
    the failure was printed.
  - `beforeExit` while `run()` has not finished:
    `core.setFailed(…ended before the install finished…)`. Node emits
    `beforeExit` only when nothing is left to do; that is exactly the "exit 0
    with a promise that never settles" of IA10.
- `dist/`: rebuilt with `npm run bundle`.

## Tests

### Jest (`__tests__/`)

- After: `INSTALL_ACTION_TEST_PORT=30700 timeout 150 npx jest -w 2` (01:03Z): 5
  suites, **43 passed, 0 failed**, exit 0; Jest exited by itself. `npm run lint`
  0 errors, `tsc --noEmit` exit 0.
- Before: the 4 changed test files copied onto `git archive 1105037` in
  `/tmp/dbs-ia10-11/base` (ts-jest type check off, so the third `resolveRelease`
  argument is ignored there), `--forceExit` (01:04Z): **18 failed, 13 passed**,
  exit 1. Every new behavior test fails, 7 of them by Jest's 5 s timeout (the
  promise never settles):

| New test                                                                            | Base 1105037          | After |
| ----------------------------------------------------------------------------------- | --------------------- | ----- |
| util: server **destroys** the connection mid-answer → lookup prefix + message       | ❌ timeout            | ✅    |
| util: server **closes** (FIN) mid-answer → same                                     | ❌ timeout            | ✅    |
| util: no data before / in the middle of the answer → fails at the limit (2)         | ❌ timeout (2)        | ✅    |
| util: proxy accepts, never answers CONNECT → lookup fails at the limit, 1 proxy hit | ❌ timeout            | ✅    |
| util: full answer of several packets over a real connection                         | ✅ (guards `readAll`) | ✅    |
| download: redirect answer whose body stops → stall error after 2 attempts           | ❌ timeout            | ✅    |
| download: proxy accepts, never answers CONNECT → stall error after 2 attempts       | ❌ timeout            | ✅    |
| lifecycle: ends the process after the action; listener removed                      | ❌ no `src/lifecycle` | ✅    |
| lifecycle: `beforeExit` before the action finished → step fails                     | ❌ no `src/lifecycle` | ✅    |
| index: imports run the action through `runToEnd`                                    | ❌ no `src/lifecycle` | ✅    |

- The other 11 base failures are the existing lookup tests: their mock now hands
  out a stream (`message`) instead of `readBody()`, which base code calls. Mock
  shape only; their assertions are unchanged.
- The lifecycle guard's real proof is the bundle probe below (exit 0 → exit 1).

### Bundle probes (`dist/index.js`, base 1105037 against head)

Local stand-in for GitHub's three hosts (HTTPS, loopback, ports 30703/30705),
adapted from the review's harness: `/tmp/dbs-ia10-11/h/b.sh`, batch 01:21Z to
01:34Z, one run each, no request leaves alfa.

| Probe                                             | Base 1105037                              | Head                                                      |
| ------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------- |
| `latest`, direct / through a working proxy        | ✅ exit 0, installed (2)                  | ✅ exit 0, installed (2)                                  |
| IA10: lookup answer cut after 100 bytes (reset)   | ❌ **exit 0**, 0 output lines, no install | ✅ exit 1 at 0.3 s, "connection closed before …"          |
| IA10: same with a clean close (FIN)               | ❌ **exit 0**, 0 output lines             | ✅ exit 1 at 0.3 s, same message                          |
| IA10: redirect answer whose body stops (download) | ❌ **exit 0** at 30 s, 1 output line      | ✅ exit 1 at 110 s, `download stalled … (3 attempts)`     |
| Lookup answer stops after 100 bytes               | ❌ still running at 50 s (killed)         | ✅ exit 1 at 30 s, "the answer stalled: no data for 30 …" |
| IA11: proxy never answers CONNECT, lookup         | ❌ still running at 50 s (killed)         | ✅ exit 1 at 30 s, same message                           |
| IA11: proxy never answers CONNECT, download       | ❌ still running at 140 s (killed)        | ✅ exit 1 at 110 s, 3 CONNECTs, `download stalled …`      |
| IA11 case 2: tunnel up, proxy ignores the close   | ✅ exit 1 at 125 s (3 × 35 s + 20 s)      | ✅ exit 1 at 110 s (3 × 30 s + 20 s)                      |

- Head 110 s = 3 attempts × 30 s + 2 waits × 10 s, the existing retry path. In
  every head failure: 0 `PATH` entries, 0 files left in `RUNNER_TEMP`.
- IA11 case 2 did not reproduce on base here: base also ended by itself. The
  review saw it with its own short-timer probe of the source, not the bundle.
  Head ends that case 15 s sooner and no longer depends on the proxy closing.
- After the head failures behind a never-answering proxy, the proxy still
  counted its connections open (`opened 3, closed 0`): the process ended anyway
  (`process.exit()`), which closes them.

## Decisions (made in this task)

- **Lookup limit 30 s, no retry.** Same number as the download watchdog. A
  lookup that gets no data for 30 s fails with the lookup prefix; it is not
  retried (it never was), so the default path fails within about 30 s instead of
  3 minutes or never. A retry would be a product change (more API calls under a
  rate limit); not done.
- **`process.exit()` after `run()`.** My first reasoning here ("written
  synchronously to the runner's pipe") was wrong: on Linux a pipe is
  asynchronous. The fix round makes the exit wait for the output (IA13, below).
- **Message for a cut answer** names the cause in plain words, not Node's
  `aborted` / `ECONNRESET`.
- **Test-only third argument** on `resolveRelease` instead of fake timers: the
  watchdog guards real sockets, which fake timers do not drive (same reason as
  the download tests).

## Open items

- The Mac gate: `npm ci && npm run all` and a `dist/` diff check (conductor).
- Release and moving `v1`: Joe.
- Not in scope, unchanged: the minimatch overrides pin, `prettier-eslint` 17,
  the super-linter bump.

## Fix round after the review (IA12, IA13)

Review of `7ecdfe6`: clonit-meta `planning/dbsnapper-clonit-future/reports/`
`review-dbs-install-ia10-11.md` (merge: yes). alfa-app's decision under
delegation (02:07Z): IA12 and IA13 land before `v1` moves; the 30 s lookup limit
without a retry stays.

- **IA12** (LOW, not reachable today): an action that rejects ended the step
  **green**. `runToEnd` called `process.exit()` in its `finally`, before the
  rejection surfaced, and nothing had set the exit code. `run()` catches
  everything today, so only a later change to `main.ts` could reach it.
  - Fix: `runToEnd` catches the rejection and calls
    `core.setFailed('The action failed unexpectedly: <message>')` (exit code 1,
    `::error::` line).
- **IA13** (NIT): `process.exit()` right after `run()` dropped output still
  queued. On Linux a pipe, which is what the runner reads, is asynchronous (the
  review cites Node's process docs). My first-round decision said
  "synchronously"; that was wrong, and the review measured it: 200,000 bytes to
  a reader 2 s late, 64,000 arrived and the error line was lost.
  - Fix: before `exit()`, `runToEnd` writes an empty string to stdout and stderr
    and waits for both callbacks. Writes complete in order, so a callback comes
    only after everything queued before it has gone out, or with the stream's
    error if the stream is broken. The `beforeExit` guard is unchanged.
- **Test gaps** the review named, closed with fake timers in a new
  `__tests__/watchdog.test.ts`: data restarts the limit, the timer is cleared
  after the work, and the limit without data rejects and calls `onStall`.
  - Not done: a test for the late answer of an ended attempt (`src/download.ts`,
    the `ended` check). The review proved that path with a probe; the conductor
    did not ask for a test.
- `dist/` rebuilt with `npm run bundle`.

### Fix round: tests

- Jest on alfa (02:12Z,
  `INSTALL_ACTION_TEST_PORT=30700 timeout 150 npx jest -w 2`): 6 suites, **48
  passed, 0 failed**, Jest exited by itself. `npm run lint` 0 errors,
  `tsc --noEmit` exit 0, `prettier --check` clean.
- The new tests (`lifecycle.test.ts`, `watchdog.test.ts`) against `7ecdfe6`'s
  sources and 2 watchdog mutants of it (`/tmp/dbs-ia10-11/`, 02:13Z):

| Test                                                  | `7ecdfe6` | Mutant: no refresh | Mutant: timer not cleared |
| ----------------------------------------------------- | --------- | ------------------ | ------------------------- |
| lifecycle: a rejecting action fails the step (IA12)   | ❌        | ❌                 | ❌                        |
| lifecycle: exit waits for queued output (IA13)        | ❌        | ❌                 | ❌                        |
| watchdog: data restarts the limit                     | ✅        | ❌                 | ✅                        |
| watchdog: timer cleared after the work                | ✅        | ✅                 | ❌                        |
| watchdog: limit without data rejects, calls `onStall` | ✅        | ✅                 | ✅                        |
| lifecycle: the 2 earlier tests (end, `beforeExit`)    | ✅ ✅     | ✅ ✅              | ✅ ✅                     |

- Real process: the review's `runToEnd` probe (`zz-life.ts` with made-up
  actions, built with `ncc` from each tree's `src/`), stdout a pipe, 02:15Z:

| Probe                                          | `7ecdfe6`                                | Head                                                       |
| ---------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| Action rejects (`throw`)                       | ❌ **exit 0**, 0 bytes of output         | ✅ exit 1, `::error::The action failed unexpectedly: boom` |
| 200,000 bytes, then the error, reader 2 s late | ❌ exit 1, 64,000 bytes, error line lost | ✅ exit 1, 200,019 of 200,019 bytes, error line seen       |
| 2,000 bytes, reader 2 s late                   | ✅ all, error line seen                  | ✅ all, error line seen                                    |
| Never settles (`beforeExit` guard)             | ✅ exit 1, guard message                 | ✅ exit 1, guard message                                   |
| Failed / succeeded with a handle left open     | ✅ exit 1 / exit 0 within 8 ms           | ✅ exit 1 / exit 0 within 8 ms                             |

- Rebuilt bundle against the local stand-in for GitHub (02:15Z): `latest` direct
  and through a proxy exit 0 and install; cut lookup exit 1 with its message;
  wrong archive exit 1 with `Checksum mismatch …`, nothing on `PATH`.

## Status

- Commits on branch `dbs-install-ia10-11`: `7ecdfe6` (IA10, IA11) on `1105037`,
  then the fix-round commit (IA12, IA13; its sha is in the `commit` message: a
  commit cannot name itself). No push, no tag, no release, no workflow started.
- First round, changed files (added/removed): `src/download.ts` 33/27,
  `src/util.ts` 63/13, `src/index.ts` 2/1, `__tests__/download.test.ts` 81/12,
  `__tests__/util.test.ts` 155/4, `__tests__/index.test.ts` 5/4, `dist/`
  rebuilt; new `src/watchdog.ts`, `src/lifecycle.ts`,
  `__tests__/lifecycle.test.ts`, this report.
- Fix round: `src/lifecycle.ts` 23/2, `__tests__/lifecycle.test.ts` 61/2, new
  `__tests__/watchdog.test.ts` 55 lines, `dist/` rebuilt (`dist/index.js`
  SHA-256 starts `829c726a93e92674`), this report.
- Ran on alfa (Node 24.22.3, `flock /tmp/dbs-heavy.lock nice -n 19`; load1 at
  most 15.04 and memory PSI avg60 at most 2.93 at each logged start, fix round
  at most 4.65 and 0.02; the first round's probe batch started at 01:21Z through
  `launch-slot` without its own load reading): lint, `tsc`, Jest, the base runs
  of the new tests, `npm run bundle`, the bundle and lifecycle probes above.
- Privacy scan and key-format scan: 0 and 0 on every changed source, test and
  report file, on the added lines of `dist/index.js` (`git diff --text`) and on
  each commit message.
  - `dist/index.js.map` is one line, so all of it counts as added: 0 private
    terms; the key-format pattern hits 6 times, the same 6 as in `1105037`'s map
    (third-party code: `Number.MAX_SAFE_INTEGER` spelled out, base64 WebAssembly
    in `undici`, a curl commit hash); `dist/index.js` likewise 6 on head and 6
    on base.
- Left: the Mac gate (`npm ci && npm run all`, `dist/` diff); release and `v1`
  are Joe's.
