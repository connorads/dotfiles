// typescript-vitest-setup.ts - the runtime backstops a static lint rule cannot reach.
// Copy to `tests/setup/hygiene.ts` and name it from the domain project's `setupFiles` in
// typescript-vitest.config.ts. It runs once per test file, before that file is imported.
//
// GATES: (1) a domain module reading the ambient clock, randomness or entropy through a
// helper no lint override scoped; (2) any test opening an HTTP connection; (3) a fake
// clock installed by one test still running in the next.
//
// SCOPE IT. Wired to the whole run, the clock ban breaks every adapter test that
// legitimately reads the clock - which is the pressure that gets the backstop deleted.
// The static half lives in the `src/domain/**` override of typescript-oxlintrc.jsonc and
// in typescript-ast-grep.yml; this file is the backstop for what actually ran, not a
// replacement for either. See typescript-testing.md, Runtime backstops.
//
// Verified 2026-09-03 against vitest 4.1.11, nock 14.0.17 (both installed are latest),
// node 24.19.0, typescript 7.0.2.
import { afterEach, beforeEach, vi } from "vitest";
import nock from "nock";

// ---- 1. no network ----------------------------------------------------------------
// Remove: a "unit" test reaches a real service and the suite is coupled to someone else's
// uptime. Called at module top level, NOT in `beforeAll`: hooks run after the test module
// is evaluated, so a request fired at import time escapes a `beforeAll` install.
// nock 14 patches node:http, node:https and `globalThis.fetch` (the widely repeated
// "nock cannot intercept fetch" is true of nock 13 and earlier only). It patches nothing
// else: a dependency importing `undici` directly, node:http2, raw node:net, dns and a
// child process all reach the wire with the run at exit 0. It is a no-undeclared-HTTP
// gate, never a no-network gate.
// TRAP: `NOCK_OFF=true` in the environment disarms nock wholesale - every interceptor and
// this block with it - and the suite exits 0 with the request served for real. Never set
// it in a CI job or a test script; if a recording session needs it, set it for that one
// command.
// TRAP: it interacts with the RNG ban below. nock builds a request id with `Math.random`,
// so an HTTP call from a guarded test surfaces as "Domain read ambient randomness" with a
// stack through `@mswjs/interceptors/src/createRequestId.ts`, never as
// `NetConnectNotAllowedError`. The gate holds - read the stack, not the message. A repo
// that wants the network message keeps this line in the unguarded project's own setup file
// instead.
nock.disableNetConnect();
// Uncomment when a test stands up its own server: 127.0.0.1 is blocked by default.
// nock.enableNetConnect("127.0.0.1");

// ---- 2. domain clock, randomness and entropy ---------------------------------------
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

// ---- 3. fake timers do not restore themselves ---------------------------------------
// Remove: a test that calls `vi.useFakeTimers()` freezes the clock for every later test in
// the file, silently, and a later test passes against a frozen `Date.now()` it never asked
// for. There is no `restoreTimers` config key and `restoreMocks: true` does not cover
// timers - this hook is the only fix. Under `isolate: false` the leak crosses files too.
afterEach(() => {
  vi.useRealTimers();
});

// REMINDER, because the config's mock options run BEFORE each test rather than after: a
// spy created at module scope in a TEST file is torn down before the first test runs, so
// the file fails from its own setup. Create spies in `beforeEach`, and build per-file
// fixtures there too - `beforeAll` is wiped by `unstubEnvs` / `unstubGlobals` before test 1.
