// typescript-vitest-setup.ts - the runtime backstops a static lint rule cannot reach.
// Copy to `tests/setup/hygiene.ts` and name it from the domain project's `setupFiles` in
// typescript-vitest.config.ts. It runs once per test file, before that file is imported.
//
// GATES: a domain module reading the ambient clock, randomness or entropy through a
// helper no lint override scoped. Universal network and timer hygiene lives in
// typescript-vitest-universal-setup.ts.
//
// SCOPE IT. Wired to the whole run, the clock ban breaks every adapter test that
// legitimately reads the clock - which is the pressure that gets the backstop deleted.
// The static half lives in the `src/domain/**` override of typescript-oxlintrc.jsonc and
// in typescript-ast-grep.yml; this file is the backstop for what actually ran, not a
// replacement for either. See typescript-testing.md, Runtime backstops.
//
// Verified 2026-09-03 against vitest 4.1.11, nock 14.0.17 (both installed are latest),
// node 24.19.0, typescript 7.0.2.
import { beforeEach, vi } from "vitest";

// ---- domain clock, randomness and entropy ------------------------------------------
// Remove: a pure-core function reads time or randomness off the ambient global and its
// tests still pass, because nothing in the test asked where the value came from.
const ban = (what: string, port: string) => (): never => {
  throw new Error(`Domain read ${what} - inject ${port}.`);
};

function installBans(): void {
  vi.spyOn(Date, "now").mockImplementation(ban("the ambient clock", "a Clock port"));
  vi.spyOn(Math, "random").mockImplementation(ban("ambient randomness", "an Rng port"));
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    ban("ambient entropy", "an IdGenerator port"),
  );
}

// Installed twice on purpose, and both calls are load-bearing:
// - at top level, so a module-scope `export const BOOT_TIME = Date.now()` is caught. That
// read happens at import, before any hook;
// - in `beforeEach`, because the config's `mockReset` / `restoreMocks` run before every
// test and tear the spies down - without this the backstop covers import time only and
// is silently absent inside every test body.
installBans();
beforeEach(installBans);

// Escapes to know, so nobody reads a green run as proof of a pure core. The clock half is
// narrower than the static rules, not wider:
// - `new Date()` - the most idiomatic clock read - is not covered; the zero-arg rule in
// typescript-ast-grep.yml is what catches it;
// - an aliased capture (`const rawNow = Date.now` at module scope) keeps the original
// function reference; the spy replaces the property;
// - `performance.now()` and `crypto.getRandomValues()` are untouched - add them here when
// the domain has a reason to know about either;
// - a worker thread or child process runs in another realm entirely.

// REMINDER, because the config's mock options run BEFORE each test rather than after: a
// spy created at module scope in a TEST file is torn down before the first test runs, so
// the file fails from its own setup. Create spies in `beforeEach`, and build per-file
// fixtures there too - `beforeAll` is wiped by `unstubEnvs` / `unstubGlobals` before test 1.
