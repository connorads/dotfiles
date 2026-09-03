// typescript-vitest.config.ts - the vitest gate config. Copy to `vitest.config.ts` at the
// repo root. Copy typescript-vitest-universal-setup.ts to universal-hygiene.ts and
// typescript-vitest-setup.ts to hygiene.ts.
//
// GATES: assertion-free tests, a committed `.only`, a floating rejection, leaked mocks /
// env stubs / fake timers, order-dependent tests, hangs. Every key below carries the
// failure mode that returns when the key is removed.
//
// WIRE IT: `"test": "vitest run --config vitest.config.ts"` in package.json, and add
// `vitest.config.ts` to the typecheck tsconfig's `include`. Both halves are load-bearing:
// - vitest resolves `vitest.config.*` THEN `vite.config.*` and takes the first without
// merging, so a scaffolder-added vitest.config.ts silently deletes every gate a repo
// kept in vite.config.ts. `--config` on a missing path exits 1, so pinning it also
// catches a rename.
// - vitest accepts unknown `test` keys with no warning at all: `restoreMock`,
// `allowOnley`, `expectt` and a misspelled `sequence.shuffle` each run clean at exit
// 0. Only tsc sees them (TS2769, "Did you mean to write ..."), and only when this file
// is inside the typechecked project. Outside it, a typo is a permanently absent gate.
//
// TRAPS THAT SURVIVE THIS FILE (no config key closes them):
// - `vi.setConfig({ expect: { requireAssertions: false } })` and
// `vi.setConfig({ restoreMocks: false, ... })` disable those gates for one file from
// inside the test. Nothing lints for it; grep for `vi.setConfig` in review.
// - `test.concurrent` with the global `expect`: one assertion in an overlapping
// concurrent batch satisfies every other concurrent test, so requireAssertions passes
// assertion-free tests (upstream vitest issue #8469). Destructure the context-local
// expect - `test.concurrent("x", async ({ expect }) => ...)` - in every concurrent
// test. `sequence.concurrent: true` turns the whole suite concurrent and opens the
// hole repo-wide.
// - `--dangerouslyIgnoreUnhandledErrors` and `onUnhandledError: () => false` both beat
// the key below; the second exits 0 with output byte-identical to a clean run.
//
// Verified 2026-09-03 against the quarantined vitest 4.1.11 toolchain.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ---- fail closed ----------------------------------------------------------------
    // Remove: a test that runs code and asserts nothing passes. Holes: a bare `expect(1)`
    // with no matcher counts as an assertion, and a `beforeEach` assertion satisfies every
    // test in the file (the counter is per-test and spans beforeEach + body, closing
    // before afterEach - `beforeAll` and `afterEach` assertions satisfy nothing). Both
    // holes close under oxlint's vitest plugin: see typescript-testing.md, Test lint rules.
    // False positives to know: `node:assert`, vitest's own exported chai `assert`, and
    // `expectTypeOf` do not count as assertions.
    expect: { requireAssertions: true },

    // Remove: the default is `!process.env.CI`, so a committed `.only` passes the
    // pre-commit hook at exit 0 and only breaks in CI - the gate is absent exactly where
    // it is cheapest to act on. Covers `.only` alone; `.skip`/`.todo` need the lint rules.
    allowOnly: false,

    // The default, pinned so a later `true` reads as a deliberate act. A floating
    // rejection fails the RUN (exit 1) while the test still reports passed - and junit/json
    // reporters emit `failures="0"`/`"success": true`, so the exit code is the only channel
    // carrying the signal. The enforcing form is the CLI flag
    // `vitest run --dangerouslyIgnoreUnhandledErrors=false`, which overrides a config
    // `true`; the config value alone is silenced by one word in a package.json script.
    dangerouslyIgnoreUnhandledErrors: false,

    // The default, pinned as a prohibition. Under `--retry`, a test that fails then passes
    // is reported with no marker at all - only tests that exhaust their retries get the
    // "(retry x2)" suffix. Raising it destroys exactly the signal `sequence.shuffle`
    // produces. Never set `passWithNoTests: true` either; it is already false.
    retry: 0,

    // ---- state hygiene --------------------------------------------------------------
    // All three run BEFORE each test, so a `vi.spyOn` created at module scope is torn down
    // before the first test runs: adopting them forces spies into `beforeEach`. They are
    // three different coverages, not belt-and-braces - `restoreMocks` covers `vi.spyOn`
    // only and does nothing to `vi.fn()` or a `vi.mock` factory, so trimming to it alone
    // leaves the commonest mock kind ungated. Remove: a mock's call history and replaced
    // return value leak into the next test, and the suite passes only in source order.
    // All three default false on vitest 4; `clearMocks` defaults true on vitest 5.
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,

    // Remove: `vi.stubEnv` / `vi.stubGlobal` values set by one test are still set in the
    // next. Scope limit: only the `vi.stub*` writers are restored - a direct
    // `process.env.X = ...` or `globalThis.X = ...` still leaks. The restore runs before
    // every test, so a fixture stubbed once in `beforeAll` is wiped before test 1.
    // TRAP: these break `test.concurrent` past `maxConcurrency` (default 5) - a starting
    // test's restore wipes the stubs of tests still in flight, manufacturing failures.
    unstubEnvs: true,
    unstubGlobals: true,

    // Installs nothing - it only supplies options to a `vi.useFakeTimers()` call a test
    // makes. It is still load-bearing: `now` defaults to the real `Date.now()`, so without
    // `now: 0` an installed fake clock freezes at wall-clock time and epoch assertions
    // vary by machine and run. There is no `restoreTimers` option and `restoreMocks` does
    // NOT restore timers - the `afterEach(vi.useRealTimers)` in the setup file is the only
    // fix. See typescript-vitest-setup.ts.
    fakeTimers: { now: 0 },

    // ---- order independence ---------------------------------------------------------
    // Remove: a test that passes only because an earlier test left state behind stays
    // green forever. `{ files: true }` alone leaves in-file order untouched, so a per-file
    // leak survives it - `tests: true` is the half that matters. Reproduce a failure with
    // `vitest run --sequence.seed=<n>` from the run header, which needs shuffle on in this
    // file (a seed alone with shuffle off runs in source order and exits 0).
    // TRAP: catching a leak is a coin flip - 20 runs over one deliberate dependence exited
    // 0 eight times. Green is not proof of order independence. Structured reporters such
    // as json and junit omit the seed, so preserve the default reporter in blocking runs.
    sequence: { shuffle: { files: true, tests: true } },

    // vitest already ships non-infinite defaults (5000 / 10000 / 10000), so these are a
    // tightening knob, not a missing gate. There is no session-wide timeout. Prefer the
    // per-test third argument `test(name, fn, 30_000)` over raising the global.
    testTimeout: 5_000,
    hookTimeout: 10_000,

    // Naming `reporters` REPLACES the array vitest picks by default, which on
    // GITHUB_ACTIONS includes `github-actions` - re-add it or CI silently loses inline
    // annotations. Never add `--silent` or `silent: true` to the blocking command, and
    // keep `--reporter=verbose` in CI if you want skip reasons: the default reporter
    // prints a whole file of skips as "Tests 2 skipped (2)" at exit 0, and only the
    // dynamic `ctx.skip("reason")` form can carry a reason at all.
    reporters: process.env["CI"]
      ? ["default", "github-actions", ["junit", { outputFile: "./reports/junit.xml" }]]
      : ["default"],

    // ---- scoping --------------------------------------------------------------------
    // `projects` exists here so the purity backstop reaches the domain suite only; a
    // repo whose whole suite is pure drops this block and hoists
    // `setupFiles: ["./tests/setup/hygiene.ts"]` to the root `test` object instead.
    // TRAP: projects inherit NOTHING from the root test object - every key above stops
    // applying, silently, the moment `projects` is set. `extends: true` INSIDE this array
    // entry is what carries them across; the same key written in a separate project config
    // file does not. Adding `projects` also stops the root's own test files running with
    // no warning, so every test path must appear in some project's `include`.
    projects: [
      {
        extends: true,
        test: {
          name: "domain",
          include: ["tests/domain/**/*.test.ts"],
          setupFiles: ["./tests/setup/universal-hygiene.ts", "./tests/setup/hygiene.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "shell",
          include: ["tests/shell/**/*.test.ts", "tests/architecture.test.ts"],
          setupFiles: ["./tests/setup/universal-hygiene.ts"],
        },
      },
    ],
  },
});
