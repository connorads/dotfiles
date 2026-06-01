import { expect, test, describe } from "bun:test";
import { parseConfig, configFromPaths } from "./config.ts";

const HOME = "/home/me";

describe("parseConfig", () => {
  test("expands tilde and keeps explicit label", () => {
    const r = parseConfig({ paths: [{ path: "~/.agents/skills", name: "agents" }] }, HOME);
    expect(r).toEqual({
      ok: true,
      value: { sources: [{ path: "/home/me/.agents/skills", name: "agents" }] },
    });
  });

  test("label defaults to basename when name omitted", () => {
    const r = parseConfig({ paths: [{ path: "/srv/myrepo" }] }, HOME);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sources[0]?.name).toBe("myrepo");
  });

  test("preserves source order (precedence)", () => {
    const r = parseConfig(
      { paths: [{ path: "/a", name: "first" }, { path: "/b", name: "second" }] },
      HOME,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sources.map((s) => s.name)).toEqual(["first", "second"]);
  });

  test("non-object → not-object", () => {
    expect(parseConfig(42, HOME)).toEqual({ ok: false, error: { kind: "not-object" } });
  });

  test("paths not an array → paths-not-array", () => {
    expect(parseConfig({ paths: "nope" }, HOME)).toEqual({
      ok: false,
      error: { kind: "paths-not-array" },
    });
  });

  test("empty paths → empty", () => {
    expect(parseConfig({ paths: [] }, HOME)).toEqual({ ok: false, error: { kind: "empty" } });
  });

  test("entry missing path → path-missing with index", () => {
    expect(parseConfig({ paths: [{ name: "x" }] }, HOME)).toEqual({
      ok: false,
      error: { kind: "path-missing", index: 0 },
    });
  });

  test("non-string name → name-not-string with index", () => {
    expect(parseConfig({ paths: [{ path: "/a", name: 5 }] }, HOME)).toEqual({
      ok: false,
      error: { kind: "name-not-string", index: 0 },
    });
  });
});

describe("configFromPaths", () => {
  test("builds sources with basename labels (--path override)", () => {
    const cfg = configFromPaths(["~/x/repo", "/abs/fixtureB"], HOME);
    expect(cfg.sources).toEqual([
      { path: "/home/me/x/repo", name: "repo" },
      { path: "/abs/fixtureB", name: "fixtureB" },
    ]);
  });
});
