
// Only run as a CLI. Guarded so the pure helpers above can be unit-tested by
// importing this module (`skills/**/*.test.mjs`, run by `pnpm test:skills`).
if (isMainModule(import.meta.url)) {
  await main();
