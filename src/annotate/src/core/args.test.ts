import { describe, expect, test } from "bun:test";
import { parseArgs } from "./args.ts";

const parsed = (...argv: readonly string[]) => {
  const result = parseArgs(argv);
  if (!result.ok) throw new Error(`expected a command, got: ${result.error}`);
  return result.value;
};

const rejected = (...argv: readonly string[]): string => {
  const result = parseArgs(argv);
  if (result.ok) throw new Error(`expected a rejection, got ${result.value.kind}`);
  return result.error;
};

describe("stash", () => {
  test("defaults to the selection source with no provenance", () => {
    expect(parsed("stash")).toEqual({
      kind: "stash",
      source: "selection",
      pane: null,
      cwd: null,
      session: null,
      entry: null,
    });
  });

  test("takes provenance from flags", () => {
    expect(parsed("stash", "--source", "pane", "--pane", "%12", "--cwd", "/tmp")).toMatchObject({
      source: "pane",
      pane: "%12",
      cwd: "/tmp",
    });
  });

  test("rejects a source it does not know", () => {
    expect(rejected("stash", "--source", "telepathy")).toContain("unknown source");
  });

  test("rejects a flag with no value", () => {
    expect(rejected("stash", "--pane")).toContain("needs a value");
    expect(rejected("stash", "--pane", "--cwd")).toContain("needs a value");
  });
});

describe("drop", () => {
  test("takes an index, the newest, or every excerpt", () => {
    expect(parsed("drop", "2")).toEqual({ kind: "drop", target: { kind: "index", index: 2 } });
    expect(parsed("drop", "last")).toEqual({ kind: "drop", target: { kind: "last" } });
    expect(parsed("drop", "all")).toEqual({ kind: "drop", target: { kind: "all" } });
  });

  test("rejects a target that is not an excerpt number", () => {
    expect(rejected("drop", "0")).toContain("not an excerpt number");
    expect(rejected("drop", "-1")).toContain("not an excerpt number");
    expect(rejected("drop", "1.5")).toContain("not an excerpt number");
    expect(rejected("drop", "banana")).toContain("not an excerpt number");
  });

  test("needs a target", () => {
    expect(rejected("drop")).toContain("needs");
  });
});

describe("bare commands", () => {
  test("take no arguments", () => {
    expect(parsed("clear")).toEqual({ kind: "clear" });
    expect(parsed("render")).toEqual({ kind: "render" });
    expect(parsed("path")).toEqual({ kind: "path" });
    expect(rejected("render", "--json")).toContain("unknown argument");
  });
});

describe("count", () => {
  // The status pill needs the spool size and whether a draft is open, and both
  // come from the same fold.
  test("--json carries the draft flag alongside the count", () => {
    expect(parsed("count")).toEqual({ kind: "count", json: false });
    expect(parsed("count", "--json")).toEqual({ kind: "count", json: true });
    expect(rejected("count", "--yaml")).toContain("unknown argument");
  });
});

describe("list", () => {
  test("takes --json", () => {
    expect(parsed("list")).toEqual({ kind: "list", json: false });
    expect(parsed("list", "--json")).toEqual({ kind: "list", json: true });
    expect(rejected("list", "--yaml")).toContain("unknown argument");
  });
});

describe("dispatch", () => {
  test("no arguments is help, not an error", () => {
    expect(parsed()).toEqual({ kind: "help" });
    expect(parsed("--help")).toEqual({ kind: "help" });
    expect(parsed("-h")).toEqual({ kind: "help" });
  });

  test("an unknown command is a usage error", () => {
    expect(rejected("frobnicate")).toContain("unknown command");
  });
});
