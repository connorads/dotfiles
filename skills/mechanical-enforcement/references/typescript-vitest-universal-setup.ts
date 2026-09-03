// Universal Vitest hygiene. Copy to tests/setup/universal-hygiene.ts and load it in
// every project. Domain-only clock and randomness bans remain in hygiene.ts.
import { afterEach, vi } from "vitest";
import nock from "nock";

// Install at module load so requests started while a test module is imported are blocked.
// NOCK_OFF disables this gate. Never set it in CI. Direct undici, http2, net, DNS and child
// processes remain outside nock's reach, so this is an HTTP gate rather than proof of no IO.
nock.disableNetConnect();
// Uncomment for a test-owned server: nock.enableNetConnect("127.0.0.1");

// restoreMocks does not restore fake timers. Without this hook one test can freeze another.
afterEach(() => {
  vi.useRealTimers();
});
