// ESLint flat config - architectural boundary rules only.
//
// WHAT IT GATES: the layer edges and call shapes a formatter cannot see - pure
// utilities importing framework modules, UI importing schema source, raw SQL and
// the raw driver outside the query layer, unwrapped dynamic `import()`, `as Type`
// assertions, and raw JSX primitives outside the design system.
//
// OPTIONAL LAYER, AND IT COSTS A SECOND COMPILER. oxlint is the default linter
// and owns the import rules natively (see references/typescript.md, "Lint
// families"); ESLint earns its place only for `no-restricted-syntax`, which
// oxlint has no native rule for (verified 2026-09-02 against oxlint 1.80.0).
// typescript-eslint 8.68.0 refuses TypeScript 7 outright ("typescript-eslint
// does not support TS 7.0.", exit 2), so this file runs only under the
// side-by-side alias recipe in references/typescript.md, "Type checking"
// (`typescript@npm:@typescript/typescript6`, `@typescript/native@npm:typescript`,
// bin `tsc6`). Verified 2026-09-03 against eslint 10.9.1, typescript-eslint
// 8.68.0 and @typescript/typescript6 6.0.2 (compiler reports 6.0.3).
//
// HOW TO WIRE IT:
//   pnpm add -D eslint typescript-eslint
//   pnpm exec eslint --max-warnings 0 src
// `--max-warnings 0` is load-bearing: ESLint exits 0 on warnings, so the
// `no-unused-vars` entry below reports and passes without it (verified: same
// file, exit 0 bare, exit 1 with the flag). Exit 1 is a finding and exit 2 is a
// config or parse error, so never branch on 1 alone.
//
// TRAPS:
//  - ESLint REPLACES a rule's options, it never merges them. Two config objects
//    that both set `no-restricted-syntax` and both match a file leave only the
//    later object's array live, silently: a file under src/app holding both a
//    `postgres` import and a `sql` tag exits 0 under the split shape and 1 under
//    the shape below. The selector arrays are shared consts spread into each
//    block for that reason, and the wide block `ignores` the narrow block's
//    paths so exactly one object owns each file.
//  - The same collision crosses files. Keep every `no-restricted-syntax` in this
//    one config. The purity gate deliberately holds none: it lives in
//    references/typescript-ast-grep.yml and references/purity-boundaries.mjs.
//  - A mistyped `files` glob fails OPEN - the block stops matching, ESLint exits
//    0, nothing says so. A mistyped rule name fails closed (exit 2). Pin a canary
//    file per block and assert exit 1 on it; see references/typescript.md,
//    "Gate integrity".
//  - Paths below (`src/utilities/`, `src/components/`, `src/db/`) are
//    illustrative. Adapt them; the partition is the point, not the names.

import tseslint from "typescript-eslint";

// Data-access bans. Every file under src/ carries these, the narrower block
// below included - it spreads this same array rather than replacing it.
const dataAccessBans = [
  {
    // Raw SQL template literals outside the query layer. A query belongs in a
    // src/db/ function that returns typed rows.
    selector: "TaggedTemplateExpression[tag.name='sql']",
    message: "Raw SQL is only allowed in src/db/** - go through the query layer.",
  },
  {
    // The driver itself is off-limits outside src/db/, so a caller cannot open
    // its own connection and route around the query layer's types.
    selector: "ImportDeclaration[source.value='postgres']",
    message: "The raw postgres driver is only allowed in src/db/**.",
  },
  {
    // Inline `import()` in arbitrary positions makes chunking unreadable. The
    // approved shape is a named wrapper: `dynamic(() => import(...))`.
    selector: "ImportExpression:not([parent.type='ArrowFunctionExpression'])",
    message: "Dynamic import() belongs inside a next/dynamic or React.lazy wrapper.",
  },
];

// Design-system bans, for the two globs holding app-level markup.
const uiPrimitiveBans = [
  {
    selector: "JSXOpeningElement[name.name='input']",
    message: "Use <Input /> from src/components/ui/input instead.",
  },
  {
    selector: "JSXOpeningElement[name.name='button']",
    message: "Use <Button /> from src/components/ui/button instead.",
  },
  {
    selector: "JSXOpeningElement[name.name='a']",
    message: "Use <Link /> from src/components/ui/link instead.",
  },
];

const appGlobs = ["src/app/**/*.{ts,tsx}", "src/components/blocks/**/*.{ts,tsx}"];

export default [
  // Parser layer. Without it ESLint reads .ts with espree and dies on the first
  // type annotation ("Parsing error: Unexpected token {"), which reads as a
  // broken source file rather than a missing parser.
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
  },

  // Framework presets need eslint-config-next, eslint-plugin-jsx-a11y and
  // @eslint/eslintrc, none of which this file depends on, so they stay commented:
  // ...new FlatCompat({ baseDirectory: import.meta.dirname })
  //   .extends("next/core-web-vitals", "next/typescript", "plugin:jsx-a11y/recommended"),

  // -------- Type safety --------
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // `as Type` is an unchecked claim: every one is a place the type system
      // stops holding. Use `satisfies`, inference, or a parse at the boundary.
      // Opt out per site with an eslint-disable carrying a reason - `as const`,
      // a DOM narrowing after a null check, untyped interop, invalid test data.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      // `!` claims a value is present with no evidence, and the crash it hides
      // surfaces far from the assertion.
      "@typescript-eslint/no-non-null-assertion": "error",

      // `_foo` is the intentional opt-out. This entry is a warning, which is
      // exactly why the gate command carries `--max-warnings 0`.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^(_|ignore)",
        },
      ],
    },
  },

  // -------- Layer boundary: pure utilities stay pure --------
  // Utilities are unit-testable with no server or framework coupling. A utility
  // that needs a server-only API is not a utility: move it to the layer that is
  // deliberately coupled (a `queries.ts` barrel), or exempt it here by name.
  {
    files: ["src/utilities/**/*.ts"],
    ignores: ["src/utilities/queries.ts", "src/utilities/revalidate.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "next/cache", message: "Utilities import no framework module - move it to the query layer." },
            { name: "next/headers", message: "Utilities import no framework module - move it to the query layer." },
            { name: "next/navigation", message: "Utilities import no framework module - move it to the query layer." },
            // Type-only edges survive: core `no-restricted-imports` honours
            // `allowTypeImports` (ESLint >= 9.37; verified on 10.9.1, type-only
            // import exit 0, runtime import exit 1). The plugin rule
            // @typescript-eslint/no-restricted-imports is deprecated since
            // 8.64.0 in favour of this one, and its deprecation is invisible in
            // the default formatter.
            // { name: "<orm-or-cms-sdk>", allowTypeImports: true,
            //   message: "Runtime usage belongs in the query layer; types are fine." },
          ],
        },
      ],
    },
  },

  // -------- Layer boundary: UI depends on generated types, not schema source --
  // If the UI imports the schema, a UI tweak drags in a migration and back.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // `group` matches the literal specifier, so a relative list misses
              // every deeper file: `../collections/*` never sees
              // `../../collections/x`. A `**/`-anchored glob matches at any
              // depth (verified: `../../../collections/things` flagged).
              group: ["**/collections/**"],
              message: "Components read generated types, never schema source.",
            },
          ],
        },
      ],
    },
  },

  // -------- Pattern bans, partitioned so no two blocks own one file --------
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/db/**", "src/migrations/**", ...appGlobs],
    rules: { "no-restricted-syntax": ["error", ...dataAccessBans] },
  },
  {
    files: appGlobs,
    // Spreads BOTH arrays. Listing only the UI bans here deletes the SQL and
    // driver bans from src/app/**, which holds the route handlers and server
    // components - the likeliest place for raw SQL in the whole tree.
    rules: { "no-restricted-syntax": ["error", ...dataAccessBans, ...uiPrimitiveBans] },
  },
];
