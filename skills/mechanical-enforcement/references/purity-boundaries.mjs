// ESLint flat config — purity rules for the functional core.
// Scope: src/domain/** (adapt to the project's pure layer).
//
// The key nuance: `no-restricted-globals` (and Biome's `noRestrictedGlobals`)
// only ban BARE identifiers — they cannot see member expressions, so
// `Date.now()`, `Math.random()`, and `process.env.X` sail straight through.
// `no-restricted-properties` is the rule that catches them, and it has no
// Biome equivalent — this is one of the genuine ESLint hold-outs.

export default [
  {
    files: ["src/domain/**/*.ts"],
    rules: {
      // -------- Ambient effects via member expressions --------
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message:
            "Domain code takes time as an argument — inject a Clock port at the shell.",
        },
        {
          object: "Math",
          property: "random",
          message:
            "Domain code takes randomness as an argument — inject an Rng port at the shell.",
        },
        {
          object: "process",
          property: "env",
          message:
            "Parse config at startup into typed values and pass it in — never read env in the core.",
        },
      ],

      // `new Date()` with no args is the same ambient clock in constructor
      // clothing; `no-restricted-properties` can't see constructors.
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "Zero-arg `new Date()` reads the ambient clock — inject a Clock port instead.",
        },
      ],

      // -------- IO modules stay out of the core --------
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:fs", "node:fs/*", "node:http", "node:net", "node:child_process"],
              message:
                "Domain code performs no IO — move the effect to the imperative shell.",
            },
            {
              group: ["../infra/*", "@/infra/*"],
              message:
                "The core must not depend on infrastructure — depend on a port interface instead.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
];

/*
ast-grep equivalent — cross-language, call-shape precise, gates via
`sg scan` (non-zero exit). Rule file, e.g. rules/no-ambient-clock.yml:

  id: no-ambient-clock-in-domain
  language: typescript
  files:
    - "src/domain/**"        # no leading ./ — ast-grep globs are rooted
  rule:
    any:
      - pattern: Date.now()
      - pattern: Math.random()
      - pattern: new Date()
      - pattern: process.env.$VAR
  message: Inject clock/rng/config through a port — the domain stays pure.
  severity: error

Run: sg scan --rule rules/no-ambient-clock.yml src/
*/
