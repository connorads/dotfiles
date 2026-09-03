// ESLint flat config - purity rules for the functional core (src/domain/**).
//
// WHAT IT GATES: ambient effects read straight out of the environment instead of
// taken as arguments - the clock, the RNG, env vars, the network - plus IO and
// infrastructure imports into the pure layer.
//
// SECONDARY ROUTE. The primary purity gate is the `overrides` block for
// src/domain/** in references/typescript-oxlintrc.jsonc, which runs the same
// three rules natively at roughly a tenth of the cost. This ESLint form is for
// repos that carry an ESLint layer anyway, and it needs the TypeScript 6
// side-by-side alias, because typescript-eslint 8.68.0 refuses TypeScript 7
// (exit 2); recipe in references/typescript.md, "Type checking". The call shapes
// no lint rule below can see - zero-arg `new Date()` above all - live in
// references/typescript-ast-grep.yml. Verified 2026-09-03 against eslint 10.9.1,
// typescript-eslint 8.68.0 and @typescript/typescript6 6.0.2.
//
// HOW TO WIRE IT:
//   pnpm add -D eslint typescript-eslint
//   pnpm exec eslint --max-warnings 0 src/domain
// Exit 1 is a finding, exit 2 a config or parse error. This file declares NO
// `no-restricted-syntax`, deliberately: references/eslint-boundaries.mjs sets
// that rule for all of src/**, and ESLint replaces rule options rather than
// merging them, so a second declaration here would silently delete one of the
// two rule sets from src/domain depending only on spread order.
//
// TRAPS:
//  - A mistyped `files` glob fails OPEN: the block stops matching and ESLint
//    exits 0 with no output. Pin a canary file with a known violation and assert
//    exit 1 on it; see references/typescript.md, "Gate integrity". A mistyped
//    rule name or option key fails closed (exit 2), which is the opposite of
//    oxlint, where a bad option key inside a pattern object is dropped in
//    silence - so the oxlint route needs the canary even more than this one.
//  - The two globals rules are complementary, not alternatives. Neither alone
//    has no hole; the misses are listed against each rule below.

import tseslint from "typescript-eslint";

export default [
  // Parser layer: without it ESLint reads .ts with espree and dies on the first
  // type annotation ("Parsing error: Unexpected token {").
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
  },

  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      // -------- Ambient effects reached through a member expression --------
      // This rule, not no-restricted-globals, is what keeps `Math.max` and
      // `new Date(ms)` legal while banning the effectful members of the same
      // objects. Verified catches: the plain call, and the destructured
      // `const { now } = Date`. Verified misses: the alias `const D = Date;
      // D.now()` and `globalThis.Date.now()`. It is also not scope-aware - a
      // parameter named `Date` is reported - so a shadowed name needs a
      // disable comment carrying a reason.
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "Domain code takes time as an argument - inject a Clock port at the shell.",
        },
        {
          object: "Math",
          property: "random",
          message: "Domain code takes randomness as an argument - inject an Rng port at the shell.",
        },
        {
          object: "process",
          property: "env",
          message: "Parse config at startup into typed values and pass it in - never read env in the core.",
        },
      ],

      // -------- Whole-object ambient globals --------
      // Ban the object outright where the core is allowed to keep none of its
      // members. `checkGlobalObject: true` is load-bearing: without it
      // `globalThis.process.env["X"]` and `globalThis.fetch` both pass silently
      // (verified - both flagged with the option, neither without). Still open:
      // `const { fetch: f } = globalThis`, which escapes both forms.
      //
      // Listing `Date` and `Math` here closes the alias hole above - `const D =
      // Date` is flagged at the assignment - at the price of flagging the pure
      // `new Date(ms)`, `new Date()` and `Math.max(1, 2)` as well (verified: 5
      // extra diagnostics on a 13-line trap file). Take that trade only in a
      // core that genuinely uses neither.
      //
      // False positive to expect: an isomorphic `typeof fetch !== "undefined"`
      // feature detect is reported, and needs a disable with a reason.
      "no-restricted-globals": [
        "error",
        {
          checkGlobalObject: true,
          globals: [
            { name: "fetch", message: "Inject an HttpClient port." },
            { name: "crypto", message: "Inject an IdGenerator port." },
            { name: "performance", message: "Inject a Clock port." },
            { name: "localStorage", message: "Inject a Storage port." },
            { name: "process", message: "Parse config at startup; pass typed values in." },
          ],
        },
      ],

      // -------- IO and infrastructure stay out of the core --------
      // `group` matches the literal specifier string, not the resolved module,
      // so a relative pattern is blind to the caller's depth: `../infra/*`
      // misses `../../infra/db.ts` from a nested domain module. Nested domain
      // modules are the normal shape, so anchor the glob with `**/` - verified
      // 3 of 3 against `../infra/db.ts`, `../infra/db/client.ts` and
      // `../../infra/db.ts`, where the relative list catches 2 under ESLint and
      // 1 under oxlint (verified 2026-09-02 against oxlint 1.80.0), so the same
      // group weakens silently on the oxlint route.
      //
      // `allowTypeImports` is native to core `no-restricted-imports` (ESLint
      // >= 9.37) and to oxlint, so a port's type still crosses the boundary
      // while its implementation does not. Verified: `import type { Order }
      // from "../infra/db.ts"` clean, the value import next to it flagged.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:fs", "node:fs/*", "node:http", "node:net", "node:child_process"],
              message: "Domain code performs no IO - move the effect to the imperative shell.",
            },
            {
              group: ["**/infra/**"],
              message: "The core depends on a port interface, never on infrastructure.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
];
