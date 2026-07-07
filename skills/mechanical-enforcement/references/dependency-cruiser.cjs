// Dependency-cruiser graph-boundary template for TypeScript projects.
// Copy to .dependency-cruiser.cjs, then adapt paths to the repo's actual layers.
// Direct one-edge bans still belong in oxlint/Biome/ESLint; use this for
// transitive "must never reach" rules and whole-graph sanity checks.

const testFiles = "\\.(?:test|spec)\\.(?:ts|tsx|js|jsx)$";

const legitimateEntryPoints = [
  "^src/server\\.ts$",
  "^src/main\\.ts$",
  "^src/index\\.ts$",
];

const frameworkRuntimeModules = [
  "^cloudflare:workers$",
  "^next/(?:cache|headers|navigation|server)$",
  "^@tanstack/react-start",
];
const effectfulAccessShellModules =
  "^src/lib/access/(?:client-ip|cookies|entry|gate-entry|rate-limit|ratelimit|session|turnstile)\\.ts$";
const accessLayerModules = "^src/lib/access/";
const accessImplementationModules = "^src/lib/access/[^/]+\\.ts$";
const authModules = "^src/lib/auth(?:\\.cli|-client)?\\.ts$";

const appShellModules = [
  ...frameworkRuntimeModules,
  "^src/(?:app|pages|routes|api|server|infra|adapters)/",
  "^src/db/(?:index|client)\\.ts$",
  accessLayerModules,
  authModules,
];
const runtimeModules = [
  ...frameworkRuntimeModules,
  "^src/(?:app|pages|routes|api|server|infra|adapters)/",
  "^src/db/(?:index|client)\\.ts$",
  effectfulAccessShellModules,
  authModules,
];

const privateContentModules =
  "^src/(?:content/private|lib/content/(?:private|site-content|gated-content))\\.ts$";

const approvedPrivateContentValueImporters = [
  "^src/(?:server|routes)/private-gate\\.ts$",
  "^src/lib/content/gated-content\\.ts$",
];
const approvedPrivateContentTypeImporters = [
  ...approvedPrivateContentValueImporters,
  "^src/(?:app|pages|routes)/private-page\\.tsx$",
];

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  extends: "dependency-cruiser/configs/recommended-strict",
  forbidden: [
    {
      name: "no-orphans",
      severity: "error",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)\\.[^/]+\\.(?:js|cjs|mjs|ts|json)$",
          "\\.d\\.(?:c|m)?ts$",
          "(^|/)tsconfig\\.json$",
          "(^|/)(?:babel|webpack|vite|vitest)\\.config\\.(?:js|cjs|mjs|ts|json)$",
          ...legitimateEntryPoints,
        ],
      },
      to: {},
    },
    {
      name: "prod-not-to-tests",
      severity: "error",
      comment:
        "Production modules must not depend on test files or test-only helpers.",
      from: {
        path: "^src/",
        pathNot: testFiles,
      },
      to: {
        path: [testFiles, "^src/.*/test-(?:db|helpers|fixtures)\\.ts$"],
      },
    },
    {
      name: "domain-not-to-app-shells",
      severity: "error",
      comment:
        "Domain/core modules stay pure: no route, adapter, DB client, auth, framework, or runtime reachability.",
      from: {
        path: "^src/(?:domain|core)/",
      },
      to: {
        reachable: true,
        path: appShellModules,
      },
    },
    {
      name: "pure-access-not-to-runtime",
      severity: "error",
      comment:
        "Pure access decisions must not reach runtime or effectful access shells. Keep effects at the shell.",
      from: {
        path: accessImplementationModules,
        pathNot: [effectfulAccessShellModules, testFiles, "\\.d\\.ts$"],
      },
      to: {
        reachable: true,
        path: runtimeModules,
      },
    },
    {
      name: "ui-not-to-server-modules",
      severity: "error",
      comment:
        "Reusable UI must not grow hidden server, adapter, database, or private-content dependencies.",
      from: {
        path: "^src/(?:components|ui|client)/",
      },
      to: {
        reachable: true,
        path: [
          "^src/(?:server|db|infra|adapters|api)/",
          privateContentModules,
          ...frameworkRuntimeModules,
        ],
      },
    },
    {
      name: "private-content-values-through-approved-boundaries",
      severity: "error",
      comment:
        "Private content values must enter the app only through approved gates.",
      from: {
        path: "^src/",
        pathNot: approvedPrivateContentValueImporters,
      },
      to: {
        path: privateContentModules,
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "private-content-types-through-approved-boundaries",
      severity: "error",
      comment:
        "Type-only imports from private content stay limited to approved boundaries.",
      from: {
        path: "^src/",
        pathNot: approvedPrivateContentTypeImporters,
      },
      to: {
        path: privateContentModules,
        dependencyTypes: ["type-only"],
      },
    },
    {
      name: "routes-not-to-db-client",
      severity: "error",
      comment:
        "Route/page modules should call application services instead of importing the database client directly.",
      from: {
        path: "^src/(?:app|pages|routes)/",
      },
      to: {
        path: "^src/db/(?:index|client)\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
  ],
  options: {
    includeOnly: "^src/",
    exclude: {
      path: [
        "^src/generated/",
        "^src/routeTree\\.gen\\.ts$",
        "^src/.*/__generated__/",
      ],
    },
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: [
        "npm",
        "npm-dev",
        "npm-optional",
        "npm-peer",
        "npm-bundled",
        "npm-no-pkg",
      ],
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    tsPreCompilationDeps: true,
    skipAnalysisNotInRules: true,
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
