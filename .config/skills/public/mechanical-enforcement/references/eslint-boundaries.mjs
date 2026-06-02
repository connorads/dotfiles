// ESLint flat config — boundary rules only.
// Biome (via Ultracite) owns formatting and general TS linting.
// ESLint's job here is to enforce *architectural* rules Biome can't express:
//   1. Layered `no-restricted-imports` (pure layer ← side-effectful layer)
//   2. `no-restricted-syntax` (raw SQL, raw JSX primitives, dynamic imports outside wrappers)
//   3. Type-assertion bans
//   4. Framework plugins (next, storybook, jsx-a11y)
//
// Paths below (`src/utilities/`, `src/components/`, `src/db/`, etc.) are
// illustrative — adapt to the project's layout. The *pattern* is what matters.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends(
    "next/core-web-vitals",
    "next/typescript",
    "plugin:jsx-a11y/recommended",
  ),

  // -------- Type safety --------
  {
    rules: {
      // Ban `as Type` entirely. Use `satisfies`, inference, or runtime validation.
      // Allowed exceptions (add `eslint-disable-next-line` with a reason comment):
      //   - `as const` for literal preservation
      //   - DOM APIs after null checks (e.g. `el as HTMLCanvasElement`)
      //   - Interop boundaries with untyped libraries
      //   - Tests intentionally creating invalid data
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      // Ban `!` non-null assertions — use proper null checks.
      "@typescript-eslint/no-non-null-assertion": "error",

      // Allow `_foo` unused vars as an intentional opt-out.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^(_|ignore)",
        },
      ],

      // axe-mandated scrollable-region-focusable pattern conflicts with this rule.
      "jsx-a11y/no-noninteractive-tabindex": "off",
    },
  },

  // -------- Layer boundary: pure utilities must stay pure --------
  // Utilities are meant to be unit-testable with no server/framework coupling.
  // If a utility needs server-only APIs, it isn't a utility — move it to
  // the intentionally server-coupled layer (e.g. a `queries.ts` barrel).
  // Exempt specific files via `ignores` when you need to opt *in* to coupling.
  {
    files: ["src/utilities/**/*.ts"],
    ignores: ["src/utilities/queries.ts", "src/utilities/revalidate.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/cache",
              message:
                "Utilities must not import server/framework modules — move to the query layer or the calling layer.",
            },
            {
              name: "next/headers",
              message:
                "Utilities must not import server/framework modules — move to the query layer or the calling layer.",
            },
            {
              name: "next/navigation",
              message:
                "Utilities must not import server/framework modules — move to the query layer or the calling layer.",
            },
            // Example: ban direct runtime import of an ORM/CMS SDK from pure code,
            // but still allow type imports so shared shapes remain visible.
            // {
            //   name: "<your-orm-or-cms>",
            //   message: "Move runtime usage to the query layer. Types are allowed.",
            //   allowTypeImports: true,
            // },
          ],
        },
      ],
    },
  },

  // -------- Layer boundary: UI must not import schema source --------
  // Components depend on *generated types*, not *schema definitions*.
  // If the UI imports from the schema source, a UI tweak can drag in a DB
  // migration and vice-versa. Point UI at the generated types file instead.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/collections/*",
                "../collections/*",
                "../../collections/*",
              ],
              message:
                "Components must not import schema source — use generated types instead.",
            },
          ],
        },
      ],
    },
  },

  // -------- Pattern bans via no-restricted-syntax --------
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/db/**", "src/migrations/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // Raw SQL template literals outside the query layer.
          // If you need a query, add a function in src/db/ that returns typed rows.
          selector: "TaggedTemplateExpression[tag.name='sql']",
          message:
            "Raw SQL is only allowed in src/db/** — go through the query layer.",
        },
        {
          // The postgres driver itself is off-limits outside src/db/.
          selector: "ImportDeclaration[source.value='postgres']",
          message:
            "The raw postgres driver is only allowed in src/db/**.",
        },
        {
          // Dynamic import() outside a named wrapper. The approved pattern is
          // `dynamic(() => import(...), { ssr: false })` via next/dynamic.
          // Inline `import()` in arbitrary locations makes chunking hard to reason about.
          selector:
            "ImportExpression:not([parent.type='ArrowFunctionExpression'])",
          message:
            "Dynamic import() is only allowed inside next/dynamic or React.lazy wrappers.",
        },
      ],
    },
  },

  // -------- UI hygiene: no raw JSX primitives outside the component library --------
  // The design system lives in src/components/ui/. App-level code should import
  // from there, not reach for raw <input> / <button> / <a>.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/blocks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
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
      ],
    },
  },
];
