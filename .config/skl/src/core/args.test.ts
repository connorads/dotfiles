import { expect, test, describe } from "bun:test";
import { parseArgs } from "./args.ts";

describe("parseArgs", () => {
  test("no args → help (the picker is the skl-pick shell glue)", () => {
    expect(parseArgs([])).toEqual({ ok: true, value: { kind: "help" } });
  });

  test("--help → help", () => {
    expect(parseArgs(["--help"])).toEqual({ ok: true, value: { kind: "help" } });
    expect(parseArgs(["-h"])).toEqual({ ok: true, value: { kind: "help" } });
  });

  test("--stdin → load with null ref (refs read from stdin)", () => {
    const r = parseArgs(["--stdin", "--target", "%3"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ kind: "load", ref: null });
  });

  test("--stdin with a positional ref → too-many-args", () => {
    expect(parseArgs(["--stdin", "alpha"])).toEqual({
      ok: false,
      error: { kind: "too-many-args", args: ["alpha"] },
    });
  });

  test("single ref → load", () => {
    const r = parseArgs(["agents/tdd"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ kind: "load", ref: "agents/tdd" });
  });

  test("explicit `load` verb is optional sugar for a bare ref", () => {
    const r = parseArgs(["load", "agents/tdd"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ kind: "load", ref: "agents/tdd" });
  });

  test("list subcommand", () => {
    const r = parseArgs(["list"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.kind).toBe("list");
  });

  test("preview subcommand carries the ref", () => {
    const r = parseArgs(["preview", "repo/alpha"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ kind: "preview", ref: "repo/alpha" });
  });

  test("inline subcommand carries the ref", () => {
    const r = parseArgs(["inline", "repo/alpha"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ kind: "inline", ref: "repo/alpha" });
  });

  test("inline needs exactly one ref", () => {
    expect(parseArgs(["inline"]).ok).toBe(false);
    expect(parseArgs(["inline", "a", "b"]).ok).toBe(false);
  });

  test("flags: target, repeatable path, submit", () => {
    const r = parseArgs(["alpha", "--target", "%3", "--path", "/a", "--path", "/b", "--submit"]);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "load") {
      expect(r.value.ref).toBe("alpha");
      expect(r.value.options).toEqual({ target: "%3", paths: ["/a", "/b"], submit: true, copy: false });
    }
  });

  test("--copy → load to clipboard instead of injecting", () => {
    const r = parseArgs(["alpha", "--copy"]);
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "load") {
      expect(r.value.ref).toBe("alpha");
      expect(r.value.options).toMatchObject({ copy: true });
    }
  });

  test("--copy composes with --stdin (the picker's ctrl-y path)", () => {
    const r = parseArgs(["--stdin", "--copy"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ kind: "load", ref: null, options: { copy: true } });
  });

  test("missing flag value → missing-value", () => {
    expect(parseArgs(["--target"])).toEqual({
      ok: false,
      error: { kind: "missing-value", flag: "--target" },
    });
  });

  test("unknown flag → unknown-flag", () => {
    expect(parseArgs(["--bogus"])).toEqual({
      ok: false,
      error: { kind: "unknown-flag", flag: "--bogus" },
    });
  });

  test("too many positional args → too-many-args", () => {
    expect(parseArgs(["a", "b"])).toEqual({
      ok: false,
      error: { kind: "too-many-args", args: ["b"] },
    });
  });

  test("--help wins even amongst other args", () => {
    expect(parseArgs(["alpha", "--help"])).toEqual({ ok: true, value: { kind: "help" } });
  });
});
