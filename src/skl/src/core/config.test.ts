import { expect, test, describe } from "bun:test";
import { parseConfig, configFromPaths } from "./config.ts";
import { BUILTIN_PAYLOAD_EXCLUDES } from "./payload.ts";

const HOME = "/home/me";

describe("parseConfig", () => {
  test("expands tilde and keeps explicit label", () => {
    const r = parseConfig({ paths: [{ path: "~/.agents/skills", name: "agents" }] }, HOME);
    expect(r).toEqual({
      ok: true,
      value: {
        sources: [
          {
            path: "/home/me/.agents/skills",
            name: "agents",
            exclude: BUILTIN_PAYLOAD_EXCLUDES,
          },
        ],
      },
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

  test("combines built-in, top-level, and per-source excludes", () => {
    const r = parseConfig(
      {
        exclude: ["**/.venv/**"],
        paths: [
          { path: "/a", name: "first", exclude: ["**/tmp/**"] },
          { path: "/b", name: "second" },
        ],
      },
      HOME,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sources[0]?.exclude).toEqual([
        ...BUILTIN_PAYLOAD_EXCLUDES,
        "**/.venv/**",
        "**/tmp/**",
      ]);
      expect(r.value.sources[1]?.exclude).toEqual([
        ...BUILTIN_PAYLOAD_EXCLUDES,
        "**/.venv/**",
      ]);
    }
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

  test("non-array top-level exclude → exclude-not-array", () => {
    expect(parseConfig({ exclude: "**/tmp/**", paths: [{ path: "/a" }] }, HOME)).toEqual({
      ok: false,
      error: { kind: "exclude-not-array" },
    });
  });

  test("non-string top-level exclude entry → exclude-not-string with index", () => {
    expect(parseConfig({ exclude: ["**/tmp/**", 1], paths: [{ path: "/a" }] }, HOME)).toEqual({
      ok: false,
      error: { kind: "exclude-not-string", index: 1 },
    });
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

  test("non-array source exclude → path-exclude-not-array", () => {
    expect(parseConfig({ paths: [{ path: "/a", exclude: "**/tmp/**" }] }, HOME)).toEqual({
      ok: false,
      error: { kind: "path-exclude-not-array", pathIndex: 0 },
    });
  });

  test("non-string source exclude entry → path-exclude-not-string with indexes", () => {
    expect(parseConfig({ paths: [{ path: "/a", exclude: ["**/tmp/**", false] }] }, HOME)).toEqual({
      ok: false,
      error: { kind: "path-exclude-not-string", pathIndex: 0, index: 1 },
    });
  });
});

describe("configFromPaths", () => {
  test("builds sources with basename labels (--path override)", () => {
    const cfg = configFromPaths(["~/x/repo", "/abs/fixtureB"], HOME);
    expect(cfg.sources).toEqual([
      { path: "/home/me/x/repo", name: "repo", exclude: BUILTIN_PAYLOAD_EXCLUDES },
      { path: "/abs/fixtureB", name: "fixtureB", exclude: BUILTIN_PAYLOAD_EXCLUDES },
    ]);
  });
});
