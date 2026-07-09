const testFiles = "\\.test\\.ts$";
const entryPoints = ["^index\\.ts$", testFiles, "^pi-coding-agent\\.d\\.ts$"];

const pureWorkflowModules = [
  "^agent-lifecycle\\.ts$",
  "^domain\\.ts$",
  "^parser\\.ts$",
  "^prelude\\.ts$",
  "^render\\.ts$",
  "^result\\.ts$",
  "^starter\\.ts$",
  "^starter-gate\\.ts$",
  "^tool-policy\\.ts$",
];

const workflowShellModules = [
  "^index\\.ts$",
  "^pi-agent-runner\\.ts$",
  "^command-actions\\.ts$",
  "^manager\\.ts$",
  "^runtime\\.ts$",
  "^snapshot-writer\\.ts$",
  "^store\\.ts$",
  "^@earendil-works/pi-coding-agent$",
  "^node:(?:fs|fs/promises|os|path|vm)$",
];

/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  extends: "dependency-cruiser/configs/recommended-strict",
  forbidden: [
    {
      name: "not-to-unresolvable",
      severity: "error",
      comment: "Pi provides its SDK module at extension runtime; every other unresolved import remains an error.",
      from: {},
      to: {
        couldNotResolve: true,
        pathNot: "^@earendil-works/pi-coding-agent$",
      },
    },
    {
      name: "no-orphans",
      severity: "error",
      from: {
        orphan: true,
        pathNot: entryPoints,
      },
      to: {},
    },
    {
      name: "prod-not-to-tests",
      severity: "error",
      comment: "Production workflow modules must not depend on test files or test-only helpers.",
      from: {
        path: "\\.ts$",
        pathNot: testFiles,
      },
      to: {
        path: testFiles,
      },
    },
    {
      name: "pure-workflow-not-to-shells",
      severity: "error",
      comment: "Pure workflow modules stay independent from Pi, persistence, runtime execution, and host I/O shells.",
      from: {
        path: pureWorkflowModules,
        pathNot: testFiles,
      },
      to: {
        reachable: true,
        path: workflowShellModules,
      },
    },
    {
      name: "runtime-not-to-pi-sdk",
      severity: "error",
      comment: "The workflow runtime talks to subagents through the AgentRunner port, never the Pi SDK directly.",
      from: {
        path: "^runtime\\.ts$",
      },
      to: {
        reachable: true,
        path: ["^@earendil-works/pi-coding-agent$", "^pi-agent-runner\\.ts$", "^index\\.ts$"],
      },
    },
    {
      name: "command-actions-not-to-pi-sdk",
      severity: "error",
      comment: "Workflow command/menu behaviour stays Pi-agnostic; index.ts adapts Pi UI to this port.",
      from: {
        path: "^command-actions\\.ts$",
      },
      to: {
        reachable: true,
        path: ["^@earendil-works/pi-coding-agent$", "^pi-agent-runner\\.ts$", "^index\\.ts$"],
      },
    },
  ],
  options: {
    includeOnly: ["^.+\\.ts$", "^node:", "^@earendil-works/pi-coding-agent$"],
    doNotFollow: {
      path: "node_modules",
      dependencyTypes: ["npm", "npm-dev", "npm-optional", "npm-peer", "npm-bundled", "npm-no-pkg"],
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
