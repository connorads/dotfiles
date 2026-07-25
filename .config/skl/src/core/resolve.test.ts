import { expect, test, describe } from "bun:test";
import { resolveRef, resolveRefs, resolveSourceRef } from "./resolve.ts";
import { parseRef } from "./ref.ts";
import type { DiscoveredSkill, Source } from "./types.ts";

const repo: Source = { path: "/repo", name: "repo", exclude: [] };
const fixtureB: Source = { path: "/fixtureB", name: "fixtureB", exclude: [] };

const skill = (source: Source, name: string): DiscoveredSkill => ({
  source,
  name,
  description: "",
  dir: `${source.path}/${name}`,
  files: ["SKILL.md"],
});

// Order = precedence: repo before fixtureB.
const skills = [
  skill(repo, "alpha"),
  skill(repo, "beta"),
  skill(fixtureB, "alpha"),
];

describe("resolveRef", () => {
  test("bare name resolves to earliest source (precedence)", () => {
    const r = resolveRef(parseRef("alpha"), skills);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.source.name).toBe("repo");
  });

  test("qualified picks the exact copy", () => {
    const r = resolveRef(parseRef("fixtureB/alpha"), skills);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.source.name).toBe("fixtureB");
  });

  test("unknown bare name → not-found", () => {
    expect(resolveRef(parseRef("missing"), skills)).toEqual({
      ok: false,
      error: { kind: "not-found", name: "missing" },
    });
  });

  test("unknown source → source-unknown", () => {
    expect(resolveRef(parseRef("ghost/alpha"), skills)).toEqual({
      ok: false,
      error: { kind: "source-unknown", source: "ghost" },
    });
  });

  test("known source, missing skill → not-found", () => {
    expect(resolveRef(parseRef("repo/ghost"), skills)).toEqual({
      ok: false,
      error: { kind: "not-found", name: "ghost" },
    });
  });

  test("source ref → expects-skill (single-skill callers reject groups)", () => {
    expect(resolveRef(parseRef("repo/"), skills)).toEqual({
      ok: false,
      error: { kind: "expects-skill", source: "repo" },
    });
  });
});

describe("resolveSourceRef", () => {
  test("returns every member in discovery order", () => {
    const r = resolveSourceRef("repo", skills);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => s.name)).toEqual(["alpha", "beta"]);
  });

  test("unknown source → source-unknown", () => {
    expect(resolveSourceRef("ghost", skills)).toEqual({
      ok: false,
      error: { kind: "source-unknown", source: "ghost" },
    });
  });
});

describe("resolveRefs (all-or-nothing batch)", () => {
  test("all valid → ok with skills in input order", () => {
    const r = resolveRefs(["beta", "fixtureB/alpha"], skills);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => `${s.source.name}/${s.name}`)).toEqual([
      "repo/beta",
      "fixtureB/alpha",
    ]);
  });

  test("a bad ref mid-batch → err (the partial-injection guard)", () => {
    // `typo` is unresolvable; the batch must fail rather than resolve `alpha`
    // and leave the bad ref to abort after the first injection.
    expect(resolveRefs(["alpha", "typo", "beta"], skills)).toEqual({
      ok: false,
      error: { kind: "not-found", name: "typo" },
    });
  });

  test("a source ref expands to all its members", () => {
    const r = resolveRefs(["repo/"], skills);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => `${s.source.name}/${s.name}`)).toEqual([
      "repo/alpha",
      "repo/beta",
    ]);
  });

  test("mixes source refs and skill refs in input order", () => {
    const r = resolveRefs(["fixtureB/", "repo/beta"], skills);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => `${s.source.name}/${s.name}`)).toEqual([
      "fixtureB/alpha",
      "repo/beta",
    ]);
  });

  test("an unknown source ref fails the whole batch", () => {
    expect(resolveRefs(["repo/", "ghost/"], skills)).toEqual({
      ok: false,
      error: { kind: "source-unknown", source: "ghost" },
    });
  });
});
