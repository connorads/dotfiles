# Mechanical Enforcement - TypeScript security

The security-shaped gates for TypeScript: the lint rules worth naming, the
runtime controls that hold and the ones that do not, the sinks no linter ships a
rule for, and the parity gaps against `references/python.md`. Routed from
`references/typescript.md`, section Picks. Verified 2026-09-03 against oxlint
1.80.0 (1.81.0 held back by the release-age quarantine), @biomejs/biome 2.5.11
(2.5.12 held back), opengrep 1.29.0, typescript 7.0.2 and node 24.19.0.

## Picks

oxlint's seven core security rules are the free tier and belong in the default
config (`references/typescript-oxlintrc.jsonc`). Biome's whole security surface
is six rules, so it adds nothing on an oxc stack. Prototype pollution has no
sound flag-level control - the ast-grep write rule plus `no-proto` is the gate.
`node --permission` is for ops scripts, never around a test runner. Opengrep is
the CI-tier dataflow layer. gitleaks stays the secrets gate - see the
`supply-chain-hardening` skill. Every sink ruff gates through its `S` codes and
TypeScript has no rule for lives in `references/typescript-ast-grep.yml`.

## Lint rules

| Rule | Encode with | Prevents | Notes |
|---|---|---|---|
| `__proto__` written or read | oxlint `no-proto` at `"error"` | The one prototype-pollution spelling a syntactic linter can see | Biome's twin `noProto` is `lint/suspicious` at warn, so it needs an explicit `"error"`. |
| `Object.prototype` methods called off the target | `no-prototype-builtins` | `x.hasOwnProperty(k)` resolving through a prototype an attacker planted | Biome `noPrototypeBuiltins`, also suspicious/warn. |
| Native prototypes stay unextended | `no-extend-native` | A polyfill or monkey-patch that every later `for...in` and library sees | Biome `noExtendNative` is nursery at info - not a gate. |
| Dynamic code execution | `no-eval`, `no-new-func`, `no-script-url` | `eval(s)`, `new Function(s)`, a `javascript:` href | Biome's `noGlobalEval` and `noScriptUrl` are the security-group twins, both error. |
| Control characters in regex literals | `no-control-regex` | `/[\x00-\x1f]/` written by accident from a copied byte range | |
| String-bodied timers | `typescript/no-implied-eval` under type-aware | `setTimeout("console.log(1)", 0)` | See the note below - the eslint-spelled rule is inert. |
| Unicode-aware regexes | `require-unicode-regexp` - watch | Lenient escapes and half-surrogate matches, the input-validation-bypass class | |

- **`no-implied-eval` is registered and inert without type-aware, and it is the only rule here that fails open.** An unknown rule name aborts the whole oxlint run (fail closed); this one parses, resolves to `deny` under `--print-config`, and reports nothing - so a config-level audit cannot distinguish it from a working rule. The type-aware spelling does work: with `options.typeAware: true` and the `oxlint-tsgolint` dev dep, `typescript/no-implied-eval` at `"error"` flags both `new Function(...)` and the string `setTimeout` (exit 1). Type-aware setup and its canary are owned by `references/typescript.md`, section Type checking.
- **`require-unicode-regexp` is pedantic, not restriction**, so a repo already running `-D pedantic` gets it whether it asked or not. It fires on every existing regex, and adding `u` is not behaviour-preserving - an escape the lenient parser tolerates becomes a parse-time `SyntaxError` - so it is a mechanical sweep, not a flip.
- **Biome's security group is six rules and that is all of it**: `noBlankTarget`, `noDangerouslySetInnerHtml`, `noDangerouslySetInnerHtmlWithChildren`, `noGlobalEval`, `noScriptUrl`, `noSecrets`. Five are error by default; `noSecrets` is **info**, which Biome's exit code never reflects, and Biome's own description points at dedicated tooling. Treat it as an editor hint. The two `dangerouslySetInnerHtml` rules are React-only and domain-recommended rather than on by default.
- **eslint-plugin-security 4.0.1 is rejected as a plugin.** All 14 rules are `warn` in its own `recommended` preset and ESLint exits 0 on warnings, so the shipped preset is a report. Three of its rules are unsound beyond the severity: `detect-object-injection` fires on every computed member read (75-100% false positives on the lane's probes) *and* misses the write it exists to catch, because its guard only fires on a bare `Identifier` key, so `o[req.body.key] = v` passes; `detect-non-literal-fs-filename` fires on 100% of a correct filesystem adapter; `detect-child-process` matches an identifier literally spelled `exec`, so `execSync` and `spawn` report nothing. Four more target dead APIs. Verified in the security-runtime lane's run, 2026-09-02.

## Prototype pollution

**The sink is a recursive merge, not `Object.assign`.** Shallow
`Object.assign({}, JSON.parse('{"__proto__":{"x":1}}'))` sets an own property on
the target and leaves `Object.prototype` untouched, while a naive recursive merge
of the same payload pollutes it globally. A rule written against `Object.assign`
produces findings reviewers correctly dismiss while the real deep merge in a
utility file stays unflagged.

Two payloads reach the prototype and the runtime flags treat them differently:

| Control | `__proto__` payload | `constructor.prototype` payload | Cost |
|---|---|---|---|
| none | pollutes | pollutes | - |
| `--disable-proto=throw` | throws | **pollutes** | Throws on any legitimate `obj.__proto__` read, including the one inside `Object.assign` |
| `--disable-proto=delete` | silently neutralised | **pollutes** | No signal at all |
| `Object.freeze(Object.prototype)` | `TypeError` | `TypeError` | Silent no-op in sloppy-mode CJS; throws only under strict mode or ESM |
| `--frozen-intrinsics` | `TypeError` | `TypeError` | Experimental; also freezes `console`, which is what breaks real code |

- **Both node flags are a watch, not a pick.** `--disable-proto` closes one of the two vectors, so shipping it as "the" control leaves a live sink; `--frozen-intrinsics` prints an experimental warning, can change between minors, and its `--require` preload runs *before* the freeze, so pollution set in a preload survives and is then frozen in place.
- **The CLI flag does not reach spawned children; `NODE_OPTIONS` does.** With `--disable-proto=throw` on the command line the main process and its worker threads are protected and a `child_process` node subprocess is not; spelled as `NODE_OPTIONS=--disable-proto=throw` the child inherits it. A container that sets the flag on `CMD` alone protects one process.
- The gate is the ast-grep `prototype-write` rule in `references/typescript-ast-grep.yml` plus oxlint `no-proto`. Two authoring traps that make that rule fail open silently: a pattern containing `'__proto__'` matches single quotes only, so the Prettier-default `"__proto__"` and the template-literal form need their own arms; and `language: typescript` does not scan `.tsx`, so a React codebase needs a duplicate `tsx` rule.

## Runtime permissions

`node --permission` is adopted **for build and ops scripts only**, where the
script's ambient authority is the whole risk and the allow-list is short. On node
24.19.0 the flags are `--allow-fs-read`, `--allow-fs-write`,
`--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi` and
`--allow-inspector`. There is **no `--allow-net` and no `--permission-audit`** -
both print `node: bad option` - so `--permission` restricts no outbound traffic
at all on this major. The entry script is implicitly read-granted; every
non-entry module it loads is not.

```sh
node --permission --allow-fs-read=./config --allow-fs-write=./dist scripts/build.mjs
```

- **A dropped `=` fails open and green.** `--allow-fs-read scripts/build.mjs` consumes the script path as the flag's value; node then has no entry point, falls back to stdin, and exits 0 with the script never running. Always write the `=` form, and assert the script prints something.
- **Reject `--permission` around vitest.** vitest 4's default pool is `forks`, and a forked pool cannot start without `--allow-child-process` - granting which hands every test file an unguarded escape, because the permission model does not propagate into the child. The `threads` pool fails closed without `--allow-worker` and fails open *with* it. Neither configuration gates anything. The test-suite equivalents are in `references/typescript-testing.md`, section Runtime backstops.

## `JSON.parse` at the boundary

Unvalidated JSON entering the domain is the commonest way an `any` gets in. Ban
`JSON.parse` everywhere but the named parsing boundary, with a
`no-restricted-properties` entry under `overrides[]` in the root `.oxlintrc.json`:

```jsonc
{ "files": ["src/**/*.ts"], "rules": { "no-restricted-properties": ["error",
  { "object": "JSON", "property": "parse", "message": "Parse at src/boundary/** with a schema." }] } }
```

It catches `JSON.parse(x)`, `JSON?.parse(x)`, the computed `JSON["parse"](x)`,
the destructure `const { parse } = JSON` (reported at the destructure site) and
`(JSON as {...}).parse(x)`. It **misses** the alias `const J = JSON; J.parse(x)`
and `globalThis.JSON.parse(x)`, both silent. It is a convention gate, not a
security boundary.

- **The type-level twin catches every spelling**, because it keys on the `any` a parse returns rather than the call shape: the `typescript/no-unsafe-*` family under type-aware flagged both the alias and the `globalThis` form as `no-unsafe-return`. That family is native to oxlint; it needs no ESLint.
- **Spelling the boundary exemption `"off"` drops every sibling entry.** An override setting `no-restricted-properties: "off"` for `src/boundary/**` also removes the `Date.now` ban that shares the rule, and reports nothing. Restate the entries that should survive in the boundary override instead of switching the rule off.
- Override glob scoping, and the way a config passed by an out-of-tree path silently matches nothing, are owned by `references/typescript.md`, section Lint families; the purity uses of the same rule by `references/architecture-boundaries.md`, section Purity.

## ReDoS

`eslint-plugin-regexp`'s `regexp/no-super-linear-backtracking` is the only
catastrophic-backtracking gate in any of these linters, and it is ESLint-only. On
TS 7 that means the side-by-side TS 6 alias (`references/typescript.md`, section
Type checking) or nothing, so **state the gap plainly: an oxlint-only TS 7 repo
has no ReDoS gate.** Keep `regexp/no-super-linear-move` off - it fires on
`/a*b/`. It cannot see a regex built from a runtime variable, so pair it with
input validation. Biome's `useTopLevelRegex` is a *performance* rule that exempts
`/g` and `/y` outright and says nothing about backtracking; its placement is
owned by `references/typescript.md`, section UI hygiene.

## Trojan Source

Bidirectional override characters make reviewed source read differently from what
compiles (CVE-2021-42574). `security/detect-bidi-characters`, extracted from the
otherwise-rejected plugin, inspects comments and string literals only, so an
identifier is uncovered, and it needs a TypeScript parser TS 7 denies it. A
greppable step is stronger and free:

```sh
! git grep -nP '[\x{202A}-\x{202E}\x{2066}-\x{2069}]' -- 'src'   # exit 1 when poisoned
```

- Verified against a file holding a real U+202E in a comment and one holding U+2066 inside a string: exit 1 dirty, exit 0 on a clean subtree.
- **Two fail-open modes.** `git grep` searches *tracked* files only, so a poisoned file that is written but never staged is invisible - run the step over a staged path set or after `git add`. Outside a work tree `git grep` exits 128, which the leading `!` converts to a pass; a hook step must assert it is in a repo.
- `grep -P` is unavailable on the BSD grep macOS ships, and a `LC_ALL=C` byte-range alternative behaves differently under grep replacements. Git's own PCRE2 is the portable route.

## Opengrep

Opengrep is the CI tier (~1s on the fixture, ~2.4s on 300 files) for the dataflow
a per-file linter cannot see: request data reaching a shell, SQL or `eval` sink
across assignments. Install from the project's own script - it is not on npm.

```sh
opengrep scan --config opengrep-rules --error --taint-intrafile --disable-nosem src
```

- **`--error` is load-bearing**: without it findings print and the exit is 0, and with it a rule declaring `severity: WARNING` still exits 1 - the flag decides the gate, not the rule's severity.
- **`--taint-intrafile` is equally load-bearing.** On the commonest real handler shape - source in the handler, `execSync` behind a same-file helper - the same rule and the same file report 0 findings and exit 0 without the flag, and 1 finding and exit 1 with it.
- **`// nosemgrep` silently disarms the gate, and `--disable-nosem` only half-restores it.** A `nosemgrep` comment on the finding line or the line above it takes the finding to 0 and exit 0. Adding `--disable-nosem` makes the finding print again - and the run still exits **0**. The flag buys visibility, not enforcement, so pair it with `! git grep -nE '(nosem|nosemgrep|noopengrep)' -- src`.
- **A bare `opengrep scan --error src` is not a no-op.** With no config it resolves `auto` and fires on the fixture's `eval(code)` and `Object.assign({}, JSON.parse(code))` with no custom rule at all - useful as a smoke check, but it puts a network call in the gate path.
- **Registry packs (`p/typescript`, `p/nodejs`, `p/security-audit`) are rejected**: they are framework-shaped rather than language-shaped, `p/security-audit` announces 225 rules and runs 22 after language filtering, and each pull is a network call. Hand-written rules plus the sinks file are the gate.
- A `paths.include` glob matching nothing prints `Ran 1 rule on 0 files` and exits 0.

## Constants: `Object.freeze` versus `as const satisfies`

Two different failures, neither substituting for the other. `as const satisfies T`
gates the compile-time contract and preserves literal types; `Object.freeze` gates
runtime mutation.

- **`as const` is erased.** A config written `as const satisfies Cfg` has zero runtime protection: `A.host = "pwned"` succeeded in a strict ES module.
- **`Object.freeze` is shallow at both levels.** `Object.freeze({ host, ports: [5, 6] })` types as `Readonly<T>`, so `C.ports.push(7)` type-checks at exit 0 *and* mutates the array at runtime, while `C.host = "x"` errors. It is also a silent no-op in sloppy-mode CJS.
- **`readonly` launders with no cast.** TypeScript ignores `readonly` property modifiers in assignability, so `const m: { host: string } = A; m.host = "pwned"` compiles clean under the fixture's strict config. The compile-time half is a convention, not a guarantee.
- An ast-grep rule requiring exported constants to be `as const satisfies` or frozen is **rejected**: it enforces neither conjunct, and `const E = {...}; export { E };` takes the object out of the rule's scope entirely.

## Sinks and parity gaps

Every sink below has a ruff `S` code and **no** TypeScript linter rule in oxlint,
Biome or eslint-plugin-security. They are hand-written rules in
`references/typescript-ast-grep.yml`, with opengrep taint rules where the value
is assembled earlier: `child_process` `exec`/`execSync`/`spawn` with a non-literal
argument (S605/S607), `tar.x` and `extractAllTo` zip-slip (S202), js-yaml v3
`load`/`unsafeLoad` and `v8.deserialize` (S301/S506), string-built SQL reaching
`db.query`/`knex.raw`/a `sql` tag (S608), `rejectUnauthorized: false` (S501),
`crypto.generateKeyPairSync` with a short `modulusLength` (S505),
`createHash("md5"|"sha1")` (S324), and `fetch` with no `signal` (S113).

Gaps that stay open, stated rather than filled with a weak rule:
`NODE_TLS_REJECT_UNAUTHORIZED=0` is invisible in source and needs a config and
Dockerfile grep; JavaScript has no `usedforsecurity=False`, so an md5 rule cannot
tell a checksum from a signature and needs an allow-comment convention; a raw
`el.innerHTML = x` assignment has no rule anywhere, and the Rust linters cannot
parse `.vue`/`.svelte` at all (`references/typescript.md`, section SFCs); and
ruff's parameter-name secret heuristic (S105-S107) has no twin. In the other
direction, TypeScript gates prototype pollution, which Python has no bug class
for, and ReDoS, where ruff ships nothing despite `re` backtracking.

## Gate integrity

Cross-cutting fails-open modes are inventoried in `references/typescript.md`,
section Gate integrity. The ones specific to this tier:

- **oxlint `no-implied-eval`** parses, resolves to `deny`, and reports nothing; only a known-bad fixture tells it from a working rule.
- **A `no-restricted-properties` override spelled `"off"`** drops every other entry in that rule for the glob.
- **Opengrep without `--error`** exits 0 with findings; without `--taint-intrafile` a same-file helper hides the flow; with `--disable-nosem` a suppressed finding prints and still exits 0.
- **`node --permission --allow-fs-read <space>`** swallows the script path and exits 0 having run nothing.
- **`! git grep`** outside a work tree exits 0 on git's own 128, and never sees an untracked file.
- **eslint-plugin-security's `recommended`** sets every rule to warn, so ESLint exits 0 on a full report.

Feed each gate its known violation and assert the non-zero exit, then feed the
same violation at an exempt path and assert zero.

## Maintenance posture

oxlint and Biome are company-backed and move weekly, so pin exact versions and
treat a minor bump as the review point for rule-tier changes. Opengrep is a
community fork of a commercial tool - keep the rule files first-party so a fork
divergence costs a binary swap, not a rewrite. `--frozen-intrinsics` is
experimental and `--permission` is Stability 2; recheck both flag sets at every
node major, since `--allow-net` lands after 24.
