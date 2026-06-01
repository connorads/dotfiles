import { expect, test, describe } from "bun:test";
import { resolveRef } from "./resolve.ts";
import { parseRef } from "./ref.ts";
import type { DiscoveredSkill, Source } from "./types.ts";

const repo: Source = { path: "/repo", name: "repo" };
const fixtureB: Source = { path: "/fixtureB", name: "fixtureB" };

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
});
