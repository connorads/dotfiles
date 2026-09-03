/**
 * Transitive architecture gate for TypeScript 7 repos, as a vitest test.
 *
 * GATES  layer reachability through any chain (barrels, re-exports, dynamic
 * `import()`, `import("x").T` type queries); a "must pass through" gateway
 * rule; runtime cycles between packages. Shortest offending chain is reported.
 *
 * WIRING  `pnpm add -D ts-morph`, copy this file to `tests/architecture.test.ts`,
 * edit the configuration block, run `pnpm vitest run tests/architecture.test.ts`.
 * The tsconfig path is resolved from the vitest cwd (the package root).
 *
 * WHY NOT dependency-cruiser  it caps at `typescript >=2.0.0 <7.0.0` and cruises
 * 0 modules on TS 7 while exiting 0. See references/dependency-cruiser.cjs and
 * architecture-boundaries.md, "Transitive architecture tests".
 *
 * TRAPS (verified 2026-09-03 against ts-morph 28.0.0, vitest 4.1.11, node 24.19.0)
 * - ts-morph 28.0.0 bundles TypeScript 6.0.2 (`ts.version`), so this graph is
 *   built by a different compiler than a TS 7 `tsc`. Aliases and resolution
 *   modes removed in 7 still resolve here; keep `tsc` as the typecheck gate.
 * - `getImportDeclarations()` / `getExportDeclarations()` return zero edges for
 *   `await import("../infra/db.ts")` and for `type R = import("...").Order`, so
 *   a test built on them passes on the laundering route it exists to close.
 *   `getLiteralsReferencingOtherSourceFiles()` returns all four constructs.
 * - A hand-rolled path predicate has no schema. A one-character typo in a layer
 *   prefix matches nothing and the suite reports green, where a
 *   dependency-cruiser config typo is a schema error. The non-empty graph and
 *   non-empty start-set assertions below are the canaries that close that.
 * - Only declaration-level `isTypeOnly()` erases the module edge. Under
 *   `verbatimModuleSyntax`, `import { type A } from "x"` still emits
 *   `import {} from "x"`, so inline type specifiers count as runtime edges.
 * - `ts.resolveModuleName` resolves into `node_modules`; `firstPartyId` drops
 *   those so a dependency's own graph never enters the layer rules.
 * - A missing or misnamed tsconfig throws `FileNotFoundError` at construction:
 *   this arm fails closed.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Node, Project, type StringLiteral, ts } from "ts-morph";

// --- configuration -------------------------------------------------------

const TS_CONFIG = "tsconfig.json";
/** Package identity for the cycle rule: one segment below each of these. */
const PACKAGE_ROOTS: readonly string[] = ["src", "packages"];
const DOMAIN = /^src\/domain\//;
const INFRA = /^src\/(?:infra|adapters|db)\//;
const APP = /^src\/app\//;
const GATEWAY = /^src\/ports\//;

// --- graph ---------------------------------------------------------------

const project = new Project({ tsConfigFilePath: TS_CONFIG });
const compilerOptions = project.getCompilerOptions();
const rootDir = path.dirname(path.resolve(TS_CONFIG));

const toId = (filePath: string): string =>
  path.relative(rootDir, filePath).split(path.sep).join("/");

/** Resolved first-party module id, or undefined for externals and unresolvables. */
const firstPartyId = (specifier: string, containingFile: string): string | undefined => {
  const resolved = ts.resolveModuleName(specifier, containingFile, compilerOptions, ts.sys)
    .resolvedModule?.resolvedFileName;
  if (resolved === undefined || resolved.includes("node_modules")) return undefined;
  return toId(resolved);
};

/** True only when the whole declaration is erased: `import type` / `export type`
 *  / `import("x").T`. A dynamic `import()` sits under a CallExpression. */
const isTypeOnlyEdge = (literal: StringLiteral): boolean => {
  const parent = literal.getParent();
  if (Node.isImportDeclaration(parent) || Node.isExportDeclaration(parent)) {
    return parent.isTypeOnly();
  }
  return Node.isLiteralTypeNode(parent);
};

type Edge = { readonly to: string; readonly typeOnly: boolean };

const graph = new Map<string, readonly Edge[]>();
for (const sourceFile of project.getSourceFiles()) {
  const containingFile = sourceFile.getFilePath();
  const edges: Edge[] = [];
  for (const literal of sourceFile.getLiteralsReferencingOtherSourceFiles()) {
    const to = firstPartyId(literal.getLiteralValue(), containingFile);
    if (to !== undefined) edges.push({ to, typeOnly: isTypeOnlyEdge(literal) });
  }
  graph.set(toId(containingFile), edges);
}

const modules: readonly string[] = [...graph.keys()].sort();
const edgeCount = [...graph.values()].reduce((n, edges) => n + edges.length, 0);
const inLayer = (layer: RegExp): readonly string[] => modules.filter((m) => layer.test(m));

// --- reachability --------------------------------------------------------

type ReachOptions = {
  /** Ignore `import type` / `export type` / `import("x").T` edges. */
  readonly runtimeOnly: boolean;
  /** Modules that legitimately absorb the path (the gateway layer). */
  readonly through?: RegExp;
};

/**
 * Breadth-first, so the first hit is a shortest chain. Returns the chain from
 * `start` to the first module matching `target`, or undefined when unreachable.
 */
const shortestChain = (
  start: string,
  target: RegExp,
  options: ReachOptions,
): readonly string[] | undefined => {
  const seen = new Set<string>([start]);
  let frontier: (readonly string[])[] = [[start]];
  while (frontier.length > 0) {
    const next: (readonly string[])[] = [];
    for (const chain of frontier) {
      const head = chain[chain.length - 1] ?? start;
      for (const edge of graph.get(head) ?? []) {
        if (options.runtimeOnly && edge.typeOnly) continue;
        if (seen.has(edge.to)) continue;
        if (target.test(edge.to)) return [...chain, edge.to];
        seen.add(edge.to);
        if (options.through?.test(edge.to) === true) continue;
        next.push([...chain, edge.to]);
      }
    }
    frontier = next;
  }
  return undefined;
};

const chainsInto = (layer: RegExp, target: RegExp, options: ReachOptions): readonly string[] =>
  inLayer(layer)
    .map((start) => shortestChain(start, target, options))
    .filter((chain): chain is readonly string[] => chain !== undefined)
    .map((chain) => chain.join(" -> "));

// --- package cycles ------------------------------------------------------

const packageOf = (module: string): string => {
  const parts = module.split("/");
  const root = parts[0] ?? module;
  const second = parts[1];
  return PACKAGE_ROOTS.includes(root) && second !== undefined && parts.length > 2
    ? `${root}/${second}`
    : root;
};

const packageGraph = new Map<string, ReadonlySet<string>>();
for (const [from, edges] of graph) {
  const source = packageOf(from);
  const targets = new Set<string>(packageGraph.get(source) ?? []);
  for (const edge of edges) {
    if (edge.typeOnly) continue;
    const target = packageOf(edge.to);
    if (target !== source) targets.add(target);
  }
  packageGraph.set(source, targets);
}

/** Depth-first with an open/closed colouring; returns the closing cycle. */
const findPackageCycle = (): readonly string[] | undefined => {
  const state = new Map<string, "open" | "closed">();
  const stack: string[] = [];
  const walk = (node: string): readonly string[] | undefined => {
    if (state.get(node) === "open") return [...stack.slice(stack.indexOf(node)), node];
    if (state.get(node) === "closed") return undefined;
    state.set(node, "open");
    stack.push(node);
    for (const next of packageGraph.get(node) ?? []) {
      const cycle = walk(next);
      if (cycle !== undefined) return cycle;
    }
    stack.pop();
    state.set(node, "closed");
    return undefined;
  };
  for (const node of [...packageGraph.keys()].sort()) {
    const cycle = walk(node);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
};

// --- rules ---------------------------------------------------------------

describe("architecture", () => {
  it("cruised a non-empty graph", () => {
    // Without this, a wrong tsconfig path or an empty `include` is a silent pass -
    // the TS-7 shape of dependency-cruiser's "0 modules cruised" fail-open.
    expect(modules.length).toBeGreaterThan(0);
    expect(edgeCount).toBeGreaterThan(0);
  });

  it("keeps domain modules out of infrastructure at runtime", () => {
    expect(inLayer(DOMAIN).length).toBeGreaterThan(0);
    expect(inLayer(INFRA).length).toBeGreaterThan(0);
    expect(chainsInto(DOMAIN, INFRA, { runtimeOnly: true })).toEqual([]);
  });

  it("routes the application layer to infrastructure only through ports", () => {
    expect(inLayer(APP).length).toBeGreaterThan(0);
    expect(inLayer(GATEWAY).length).toBeGreaterThan(0);
    expect(chainsInto(APP, INFRA, { runtimeOnly: true, through: GATEWAY })).toEqual([]);
  });

  it("has no runtime cycle between packages", () => {
    expect(packageGraph.size).toBeGreaterThan(1);
    expect(findPackageCycle()?.join(" -> ")).toBeUndefined();
  });
});
