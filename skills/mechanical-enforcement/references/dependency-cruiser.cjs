/*
 * Transitive graph-boundary gate for TypeScript repos on typescript < 7.
 * Copy to .dependency-cruiser.cjs and adapt the layer regexes.
 *
 * GATES  reachability ("domain must never reach infra through any chain"),
 * folder cycles, `required` rules ("every route reaches the auth guard"), and
 * the direct value/type-import split. Direct one-edge bans belong in oxlint -
 * see architecture-boundaries.md, "Boundary tool matrix (TypeScript)".
 *
 * HARD PRECONDITION: typescript < 7 (verified 2026-09-03, dependency-cruiser
 * 18.2.0). `src/meta.cjs` declares `supportedTranspilers.typescript =
 * ">=2.0.0 <7.0.0"`. With typescript 7 installed, .ts/.tsx/.d.ts/.cts/.mts are
 * dropped from `scannableExtensions`, so `depcruise src` reports "0 modules,
 * 0 dependencies cruised" and EXITS 0 on a tree full of violations. The
 * `‼ missing-typescript-transpiler` note prints only when `options.tsConfig`
 * is set (it is, below); omit it and the fail-open is silent. Widening the
 * range does not help: typescript 7.0.2 publishes only `./lib/version.cjs`, so
 * `ts.createSourceFile` is undefined and depcruise dies mid-run instead.
 *
 * TS 7 ROUTES  (a) keep the lint stack on TS 6 side by side -
 * `pnpm add -D typescript@npm:@typescript/typescript6@6.0.2`; `depcruise
 * --info` then reports `✔ typescript ... typescript@6.0.3` and `✔ .ts`. Trap:
 * that package ships bin `tsc6`, so the alias removes `node_modules/.bin/tsc`
 * and any `tsc -p` script silently falls through to whatever is on PATH.
 * (b) a sidecar `tools/dc/package.json` holding dependency-cruiser plus
 * typescript 6, run from the repo root - depcruise resolves `typescript`
 * relative to its own install, so the project keeps TS 7 and its `tsc`.
 * (c) on a TS 7 repo, use references/typescript-arch-test.ts instead.
 *
 * GATE COMMAND - the transpiler assertion is load-bearing, not decoration:
 *   depcruise --info | grep -qE '^\s+✔ \.ts$' || { echo "depcruise: no TS transpiler"; exit 1; }
 *   depcruise src --config .dependency-cruiser.cjs --output-type err-long --no-cache
 * `--info` prints ✔/x glyphs, never the string "true"; a `grep -c true` guard
 * is a permanent false positive. Asserting `summary.totalCruised > 0` from
 * `-T json` discriminates equally well.
 *
 * REPORTER AND EXIT CODE  the exit code is the error COUNT, masked to 8 bits
 * by node, so exactly 256 errors exits 0. Test `!= 0`, never `== 1`: exit 1
 * also means an invalid config, an unknown `-T` value, an unreadable file
 * argument, or missing graphviz. Only err, err-long, null, teamcity and
 * azure-devops gate; json, markdown, err-html, text, flat, archi, dot and the
 * rest exit 0 on error-severity violations. `github-actions` is not a reporter
 * and exits 1 on a clean tree. Rule `comment` text prints under err-long,
 * teamcity, json, markdown and err-html - not under the default err. The
 * reporter cannot move into this file: `options.outputType` is in the shipped
 * .d.mts types but rejected by the config schema, so `-T` has to be spelled at
 * every call site (package script, hk step, CI).
 *
 * OTHER TRAPS  `reachable: true` rejects `via`, `viaOnly` and
 * `dependencyTypes`/`dependencyTypesNot` at the schema, so a transitive rule
 * cannot do the type/value split - that needs a second config, or the direct
 * rules below. `via` on a NON-circular rule is accepted and silently ignored,
 * which widens the rule rather than narrowing it. `viaNot` is deprecated in
 * favour of `viaOnly.pathNot`. A path regex matching nothing fails open in
 * silence, while every key and enum typo fails closed at the schema - so the
 * module count in the summary line is the only signal separating a real pass
 * from a typo'd path. `depcruise-baseline` matches reachability violations on
 * `from` + rule name only, so one baselined entry grandfathers every future
 * violation of that rule from that module, to any target, forever, and stale
 * entries never expire. Keep this config in .cjs: neither cache strategy
 * hashes the rule set, and a .json/.yaml config is invisible to the change
 * list both strategies filter on, so an uncommitted rule addition serves a
 * stale result. Prefer --no-cache in hooks.
 */

/** Framework modules that are runtime by nature, whatever the folder. */
const frameworkRuntime = [
  "^cloudflare:workers$",
  "^next/(?:cache|headers|navigation|server)$",
  "^@tanstack/react-start",
];

const testFiles = "\\.(?:test|spec)\\.(?:ts|tsx|js|jsx)$";
const domainModules = "^src/(?:domain|core)/";
const gatewayModules = "^src/ports/";
const infraModules = ["^src/(?:infra|adapters|db|server|api)/", ...frameworkRuntime];

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  // recommended-strict also carries not-to-unresolvable at error severity,
  // which is what keeps a dropped `tsConfig` from silently passing aliased
  // boundary crossings. It exports `options.doNotFollow` as well as its rules.
  extends: "dependency-cruiser/configs/recommended-strict",
  forbidden: [
    {
      name: "no-orphans",
      comment:
        "Orphan = no incoming AND no outgoing edge, so dead code that imports anything is invisible here. knip owns dead code; see typescript.md, Dead code (knip).",
      severity: "error",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(?:js|cjs|mjs|ts|json)$",
          "\\.d\\.(?:c|m)?ts$",
          "(^|/)tsconfig\\.json$",
          "(^|/)(?:babel|webpack|vite|vitest)\\.config\\.(?:js|cjs|mjs|ts|json)$",
          "^src/(?:index|main|server)\\.ts$",
        ],
      },
      to: {},
    },
    {
      name: "prod-not-to-tests",
      comment: "Production modules must not depend on test files or test-only helpers.",
      severity: "error",
      from: { path: "^src/", pathNot: testFiles },
      to: { path: [testFiles, "^src/.*/test-(?:db|helpers|fixtures)\\.ts$"] },
    },
    {
      name: "domain-not-to-infra",
      comment:
        "Domain stays pure: no route, adapter, DB client or framework runtime reachable through any chain, barrels included. Needs tsPreCompilationDeps - see options.",
      severity: "error",
      from: { path: domainModules, pathNot: testFiles },
      // `reachable` is the transitive engine. It takes path/pathNot only:
      // adding via, viaOnly or dependencyTypes here is a schema error.
      to: { reachable: true, path: infraModules },
    },
    {
      name: "domain-not-to-infra-values",
      comment:
        "Direct value-import arm of the rule above. A reachable rule cannot express the type/value split, so this catches the one-hop case with the port-type escape hatch intact; the transitive case is covered without the split.",
      severity: "error",
      from: { path: domainModules, pathNot: testFiles },
      to: { path: infraModules, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "ui-not-to-server-modules",
      comment: "Reusable UI must not grow hidden server, adapter or database dependencies.",
      severity: "error",
      from: { path: "^src/(?:components|ui|client)/" },
      to: { reachable: true, path: infraModules },
    },
    {
      name: "no-folder-cycle",
      comment:
        "Package-level cycle gate. `scope: folder` keys on the module's IMMEDIATE parent directory, not on package identity, so a monorepo cycle whose two legs sit in different subfolders is missed - references/typescript-arch-test.ts owns the package-identity version.",
      severity: "error",
      scope: "folder",
      from: {},
      // `via`/`viaOnly` are honoured only on a circular rule; use
      // viaOnly.pathNot to confine which folders may close a cycle.
      to: { circular: true },
    },
  ],
  required: [
    {
      name: "app-through-ports",
      comment:
        "Every application module reaches infrastructure through a port. A required rule judges only modules already in the graph, so run it against a directory root - cruising an entry point instead skips exactly the unwired module the rule exists to catch. At severity warn it is decorative: warnings never reach the exit code.",
      severity: "error",
      module: { path: "^src/app/", pathNot: testFiles },
      to: { path: gatewayModules },
    },
  ],
  options: {
    includeOnly: "^src/",
    exclude: { path: ["^src/generated/", "^src/.*/__generated__/"] },
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    // Without this the graph is post-transpile: type-only edges vanish, so
    // EVERY domain-to-infra rule silently misses them, and edges retag from
    // export/import to require, changing what a dependencyTypes rule matches.
    // `"specify"` behaves identically on a reachable rule and additionally
    // enables the "pre-compilation-only" dependencyTypes value.
    tsPreCompilationDeps: true,
    // Skips a derivation only when no rule needs it. With reachable rules in
    // play it can drop just the `dependents` pass, so expect single digits
    // here; on a path-only rule set it is worth ~70%.
    skipAnalysisNotInRules: true,
    reporterOptions: { text: { highlightFocused: true } },
  },
};
