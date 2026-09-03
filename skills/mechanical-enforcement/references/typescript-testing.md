# Mechanical Enforcement - TypeScript testing

The runner config that fails a suite closed, the static test lints, and the
runtime backstops that catch what a linter cannot see. Routed from the picks
table in `typescript.md`, `## Picks`. Test strategy belongs to the `testing`
skill; coverage thresholds and mutation testing to `test-coverage`; the
fails-open inventory and the canary discipline to `typescript.md`,
`## Gate integrity`. Drop-ins: `references/typescript-vitest.config.ts`,
`references/typescript-vitest-universal-setup.ts`, `references/typescript-vitest-setup.ts`, and the `tests/**` overrides block of
`references/typescript-oxlintrc.jsonc`.

Every exit code below was observed 2026-09-03. Vitest 4.1.11 remains installed
because the release-age quarantine holds back 5.0.0; nock and msw are current. oxlint 1.80.0
and Biome 2.5.11, where the 4-day release-age quarantine holds back oxlint 1.81.0
and Biome 2.5.12.

## Vitest gates

vitest validates nothing. An unknown `test.*` key is accepted in silence, so
every row here is only as armed as the spelling. `tsc` is the spell-checker -
see [Structural traps](#structural-traps).

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| Assertion-free tests | `expect: { requireAssertions: true }` | A test that runs code and asserts nothing | Violation exit 1, clean exit 0. Three holes below; pair with the lint layer. |
| No committed `.only` | `allowOnly: false` | One focused test reporting a green suite | Default is `!process.env.CI`, so a `.only` passes the pre-commit hook at exit 0 and breaks only in CI. Covers `.only` alone: `.skip` and `.todo` exit 0 under it. |
| Mock state stays inside its test | `clearMocks` + `mockReset` + `restoreMocks`, all three | A spy's call history or replaced implementation deciding whether the next test passes | All default false on 4.x. They are three coverages, not three strengths - see below. |
| Stub state stays inside its test | `unstubEnvs` + `unstubGlobals` | `vi.stubEnv` / `vi.stubGlobal` leaking into every later test | Covers the `vi.stub*` writes only: a direct `process.env.X = "v"` leaks to the next test at exit 0. |
| Order independence | `sequence: { shuffle: { files: true, tests: true } }` | A test that passes only because an earlier one left state behind | `{ files: true }` alone leaves in-file order untouched (0 catches in 6 runs of a deliberate leak); with `tests: true`, 5 catches in 10. |
| No retry laundering | `retry: 0`, and never a retry flag in the blocking command | A racy test reported as a clean pass | The config line is inert against `test(name, { retry: 3 }, fn)`, which overrides it at exit 0. |
| A floating rejection fails the run | leave `dangerouslyIgnoreUnhandledErrors` false; spell `--dangerouslyIgnoreUnhandledErrors=false` in CI | A forgotten `await` reported as a passing test | Judge on the exit code, not the report - see below. |
| Type-level assertions run | `typecheck: { enabled: true }` plus a separate `tsc -p tsconfig.json` | Type errors nothing executes | Silently checks nothing when no file matches `typecheck.include`. |
| A known bug is visible | `test.fails(...)`, never `test.skip` | A known-broken test staying marked broken after the bug is fixed | Fails the run (exit 1) the moment the body passes, but any throw satisfies it. |

- **`requireAssertions` has three holes, one of them wide.** A bare `expect(1)` with no matcher counts as an assertion; `vi.setConfig({ expect: { requireAssertions: false } })` at the top of a test file disables it for that file at exit 0, and nothing lints for that call; and one global-`expect` assertion anywhere in an overlapping `test.concurrent` batch satisfies every other concurrent test in flight (three concurrent tests, two of them assertion-free, exit 0, "3 passed"). The context-local `expect` destructured from the test argument closes the third. It also **fails a genuinely asserting test** that uses `node:assert` (exit 1, "expected any number of assertion, but got none"), so it is a whole-suite commitment to `expect`, not a drop-in.
- **`restoreMocks` alone covers `vi.spyOn` and nothing else.** A module-scope `vi.fn().mockReturnValue("x")` leaks its return value and its call history into the next test at exit 0 under restore-only, and fails under `clearMocks` + `mockReset`. All three run *before* each test, so a spy or stub built at module scope or in `beforeAll` is torn down before the first test - the options force setup into `beforeEach`.
- **The shuffle gate is a coin flip, and the seed is the only reproducer.** The header line `Running tests with seed "<n>"` feeds `vitest run --sequence.seed=<n>`, which reproduces deterministically. `--reporter=github-actions` prints no seed line at all, so the natural CI reporter throws the reproducer away.
- **A machine-readable report can be green while the run is red.** On a floating rejection the process exits 1 while `--reporter=json` writes `"success": true, "numFailedTests": 0, "numPassedTests": 1` - any dashboard reading the artefact rather than the exit code sees a clean suite. `onUnhandledError: () => false` is the real silencer: exit 0 with output identical to a clean run.
- **`typecheck.enabled` with no matching file spawns no checker at all.** With zero `*.test-d.ts` files and one real `TS2322` in `src/`, the run exits 0 with no warning while `tsc -p tsconfig.json` exits 1 on the same tree. Add one `*.test-d.ts` and it checks the whole tsconfig project (exit 1) while the summary still reads `Type Errors  no errors`. `--typecheck.only` fails closed on the same tree (exit 1, "No test files found"), so it is the honest canary. The `tsc` gate stays either way - see `typescript.md`, `## Type checking`.
- **`test.fails` proves only that something threw.** A `beforeEach` that throws satisfies it (exit 0, "1 expected fail"), and so does an unrelated `TypeError` in the body. There is no `raises=`-style narrowing, so pair it with a specific `expect(() => ...).toThrow(X)` inside.
- **The name filter is not covered by `passWithNoTests`.** `vitest run -t "<typo>"` selects nothing and exits 0 ("2 skipped"), where a *file* filter matching nothing exits 1. Keep `-t` out of any blocking command.

### Runner limits and reporting

- Timeouts report after a promise race; they do not pre-empt synchronous work. Zero disables them, and a hanging global teardown is not interrupted by `teardownTimeout`.
- Keep `--bail` out of blocking runs. Parallel workers can leave a red process with green or empty JSON/JUnit, `--bail=abc` disables it, and bare `--bail` consumes the next positional.
- Naming `reporters` or passing `--reporter` replaces Vitest's automatic array. Under GitHub Actions, re-add `github-actions` or inline annotations disappear.

## Structural traps

The gates above vanish wholesale under four config-shaped changes, each silent.

- **A typo disarms the key and nothing says so.** `expectt: { requireAssertions: true }` runs the assertion-free fixture at exit 0 with no warning. `tsc` names it exactly (`TS2769 ... Did you mean to write 'expect'?`) but only once the config file is in the program: with the usual `include: ["src", "tests"]` the same typo passes `tsc` at exit 0. Add `"*.config.*ts"` to `include` - the literal `"vitest.config.ts"` misses a `.mts` config, which vitest still loads. tsc errors on nothing when an `include` entry matches no file, so assert the file is in the program (`tsc --listFiles | grep vitest.config`).
- **Excess-property checking only sees a fresh object literal.** `const shared = { globals: true, expectt: { ... } }; defineConfig({ test: { ...shared } })` typechecks at exit 0 and runs ungated at exit 0 - the shared-base-config shape a monorepo reaches for first. Spell the gates inline, or type the shared object as `InlineConfig` at its definition.
- **`vitest.config.ts` replaces `vite.config.ts` outright.** Gates living in `vite.config.ts` are all lost the day a scaffolder drops an empty `vitest.config.ts` beside it (exit 1 becomes exit 0, no message). Precedence runs `.ts` before `.mts`. Pinning `--config` protects only the file it names, so pin it at whichever file holds the `test` block.
- **`projects` inherits nothing per-test, `setupFiles` included.** A root config carrying `expect.requireAssertions` and a setup file, plus one `projects` entry, runs the assertion-free test at exit 0 and never executes the setup file. `extends: true` fixes it **only** in an inline project object inside the root `projects` array (exit 1, setup file runs); written inside a package's own config file the key is ignored. Root keeps the run-level options - reporters, coverage - and nothing else.
- **An empty matrix beside a surviving test disappears in silence.** `test.each([])` in a mixed file prints nothing at all and exits 0; alone in its file it fails loudly ("No test suite found in file", exit 1). The guard is a helper that throws at module scope, so it aborts collection:
- **A header-only template table runs one phantom test.** Guard parsed data rows, not the table including its header.

```ts
export function nonEmpty<T>(xs: readonly T[], label: string): readonly T[] {
  if (xs.length === 0) throw new Error(`[empty-matrix] ${label} produced no cases`);
  return xs;
}
// test.each(nonEmpty(CASES, "CASES"))(...)  -> exit 1 when CASES is empty
```

It is a per-call-site convention, not a config key. A new file that forgets it is
unguarded again, and the throw kills collection of its whole file.

## Test lint rules

oxlint's vitest plugin is the static layer, because it is the only one that runs
alongside TypeScript 7 - ESLint's typescript-eslint parser refuses TS 7 outright
(`typescript.md`, `## Type checking`). Two plugin-level traps decide whether it
gates anything:

- **`"plugins": [...]` replaces the default plugin set.** Adding `"vitest"` to a config that relied on the defaults drops `typescript`, `unicorn`, `oxc` and `import` with no message. A `typescript/no-explicit-any` violation goes unreported under `"plugins": ["vitest"]` and is reported again only once the array lists every plugin the repo relies on. See `typescript.md`, Lint families and suppressions.
- **Enabling the plugin puts its whole rule set at `warning`, and warnings exit 0.** A file holding `test.only`, `test.skip`, a bare `expect`, an assertion-free test and a message-less `toThrow` produces 7 warnings and exit 0 under `--vitest-plugin`; `--deny-warnings` makes it exit 1, and so does naming each rule `"error"` (6 errors on the same file). `-D warnings` reaches nothing (exit 0), and `-D vitest` with no config prints zero bytes at exit 0. An unknown rule name in the config aborts the run (exit 1).

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| No committed `.only` / `.skip` | `vitest/no-focused-tests`, `vitest/no-disabled-tests`, both `"error"` | The half `allowOnly` cannot reach | The runner covers `.only` only, and only when `allowOnly: false` is spelled. |
| A bare `expect(x)` with no matcher | `vitest/valid-expect` | The assertion that satisfies every other assertion gate | The only rule of the three that catches it. |
| An assertion parked in a hook | `vitest/no-standalone-expect` | A hook's `expect` standing in for the test's | |
| Tests with no assertion at all | `vitest/expect-expect` with `assertFunctionNames: ["expect", "expectTypeOf", "assert*"]` | The static half of `requireAssertions` | Without the option a custom `assertX()` helper is a false positive. The misspelt option key `assertFunctionName` is accepted silently and the allow-list is discarded. |
| `.toThrow()` with no argument | `vitest/require-to-throw-message` | An assertion that passes on any throw | `toThrow(DomainError)` is flagged by nothing - see [Parity](#parity-and-pointers). |

Biome is the fallback where oxlint cannot see the file (a `bun:test` import) and
carries the reason-bearing suppression. Its test rules are **warning**-severity,
and Biome's exit code counts errors only:

- Recommended defaults report `noFocusedTests` alone, as a warning, exit 0. `linter.domains.test = "all"` adds `noSkippedTests`, still both warnings, still exit 0.
- Spelling `"error"` on `suspicious.noFocusedTests`, `suspicious.noSkippedTests` and `nursery.useExpect` gives 3 errors and exit 1; `--error-on-warnings` also exits 1. A misspelt rule name fails closed (config deserialisation error, exit 1).
- `nursery.useExpect` takes **no options** (`Found an unknown key 'assertFunctionNames'`, exit 1), so every custom assertion helper is a false positive, and a bare `expect(1)` satisfies it. Biome has no `valid-expect` equivalent.
- A committed skip that survives review carries its reason in the suppression: `// biome-ignore lint/suspicious/noSkippedTests: blocked on vendor fix #123`. Biome's grammar makes the reason mandatory, which is the nearest thing TypeScript has to a reasoned-skip audit.
- Biome misses dynamic `ctx.skip(reason)` while oxlint reports it. Both miss `test.todo`; verbose reporting is visibility only and skips still exit 0.

## Runtime backstops

Static rules see imports and call shapes. These see what actually ran, including
through a helper no glob scoped. Each is a `setupFiles` entry, and each dies
silently under `projects` unless the project config carries it.

| Backstop | Encode with | Catches | Misses |
|---|---|---|---|
| No network | `nock.disableNetConnect()` at the top level of a setup file | `fetch` and `node:https` (both exit 1 where an unguarded run exits 0) | Raw `node:net` passes at exit 0; `NOCK_OFF=true` disarms the whole thing at exit 0 |
| No undeclared HTTP | msw `server.listen({ onUnhandledRequest: "error" })` | The unhandled request, by name | Everything MSW treats as a common asset, `.json` included; a caught rejection; raw sockets |
| No ambient clock or RNG in the domain | spies that throw, installed at the setup file's top level | `Date.now`, `Math.random`, `crypto.randomUUID`, `fetch`, including at module-evaluation time | `new Date()` and `performance.now()` pass at exit 0 |

- **Placement decides whether the import-time read is covered.** With the spies installed inside `beforeEach`, a domain module's `export const BOOT_TIME = Date.now()` is evaluated before the hook runs and passes. Installing them at the setup file's top level fails the file at collection instead. Same rule for msw: `server.listen()` inside `beforeAll` leaves a module-scope `fetch` uncovered.
- **The tidy-up hook disarms the guard.** An `afterEach(() => { vi.unstubAllGlobals(); })` beside the top-level bans removes the `fetch` ban after the first test: the first test fails and the second passes at the same call. Drop the hook and all four bans hold for every test in the file (4 failed of 4). The setup file re-runs per test file, so nothing needs restoring between files.
- **The clock/RNG backstop must be scoped to the domain project**, or every shell test that legitimately reads the clock turns red and the whole backstop gets deleted. That scoping is a `projects` entry, which is exactly the shape that drops root `setupFiles` - so the entry carries its own `setupFiles`. The static half of the same ban lives in `architecture-boundaries.md`, `## Purity`.
- **msw's default is silence, not a warning.** `onUnhandledRequest` defaults to `"warn"`, and a passing vitest file prints no msw output at all - the run exits 0 with the request served from the real internet. The `"error"` strategy still exempts asset-looking URLs: an unhandled `https://<host>/config.json` completed against the network at exit 0 in the same run that blocked `https://<host>/`.
- **msw fails the request, not the test.** Ordinary adapter code (`try { await fetch(url) } catch { return null }`) turns the gate green at exit 0. nock's rejection is swallowed the same way. Neither is the pytest-socket twin on that axis.
- **nock blocks localhost too**, so a test standing up its own HTTP server needs `nock.enableNetConnect("127.0.0.1")`. Running nock and msw in one process is asking for interference - they share `@mswjs/interceptors`.
- **`fakeTimers` in the config installs nothing.** It supplies options to a `vi.useFakeTimers()` call a test must make; `now: 0` is what makes the frozen instant reproducible rather than wall-clock. There is no `restoreTimers` option, and `restoreMocks: true` does not restore timers. A test that installs fake timers and never restores freezes the clock for every later test in the file at exit 0. Only `afterEach(() => { vi.useRealTimers(); })` in a setup file breaks the leak (exit 1 on the leaking pair). Reaching for fake timers inside a domain suite is itself a purity finding.

## bun test

**vitest is the default runner. Choose `bun test` only for an all-bun,
unit-level project**, and only knowing what cannot be expressed in a checked-in
file. The criterion is config-expressibility, not speed.

- **`bunfig.toml` `[test]` ignores `timeout`, `bail`, `retry`, `randomize` and `rerunEach`.** A test sleeping 300ms under `[test] timeout = 100` passes at exit 0; `bun test --timeout=100` on the same file exits 1. A bogus key in the same table is accepted in silence, and there is no `defineConfig` type to hand to `tsc`. Those gates live in a shell string a bare `bun test` bypasses.
- **`.only` is honoured silently** - one focused test in a four-test file prints "Ran 1 test across 1 file" at exit 0, and no flag or key makes it an error. The gate has to move to the linter, and **oxlint's vitest rules see nothing in a `bun:test` file** (exit 0, zero findings, no warning): only Biome's syntax-based rules fire (`noFocusedTests` + `noSkippedTests`, exit 1). That leaves the bare-`expect` hole uncloseable on bun.
- **`coverageThreshold` gates, invisibly, and a partial table does not scope it.** `coverageThreshold = { lines = 0.5 }` on a tree at 100% lines exits 1 because an unnamed metric is still checked; naming all three passes. The failing run prints the ordinary coverage table and `0 fail`, with nothing but the exit code disagreeing.
- **Two axes where bun is stricter than vitest**, both silent holes in vitest: `bun test -t "<no match>"` exits 1 ("matched 0 tests") where vitest exits 0, and bun attributes an unhandled rejection to the test rather than passing the test and failing the run.
- `bun test --randomize` is the order-independence gate, and it prints its reproducer pre-formatted as a pasteable `--seed=2964838949`.
- The migration signal is mechanical. The day the suite needs `expect.requireAssertions` or type-level tests, it needs vitest, and bun has neither.

## Parity and pointers

- Coverage thresholds, `coverage.thresholds.autoUpdate` as a ratchet vehicle, and mutation testing belong to the `test-coverage` skill; the ratchet's placement rule is in `ratcheting.md`. Layer choice, doubles and flaky-test strategy belong to the `testing` skill.
- No twin exists for pytest's `strict_config` (a typo is silent, `tsc` over the config file is the substitute), `strict_markers` (nothing validates a `-t` pattern), `empty_parameter_set_mark` (the `nonEmpty` helper is per-call-site) or `required_plugins` (nothing asserts a setup file loaded and did its job).
- `toThrow(DomainError)` with no message is accepted by every linter tested, so python.md's `raises-require-match-for` row has only its zero-argument half covered here.
