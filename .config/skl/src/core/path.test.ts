import { expect, test, describe } from "bun:test";
import { expandTilde, posixBasename, posixDirname, posixJoin } from "./path.ts";

const HOME = "/home/me";

describe("expandTilde", () => {
  test("bare ~ becomes home", () => {
    expect(expandTilde("~", HOME)).toBe(HOME);
  });
  test("~/ prefix expands", () => {
    expect(expandTilde("~/.agents/skills", HOME)).toBe("/home/me/.agents/skills");
  });
  test("$HOME prefix expands", () => {
    expect(expandTilde("$HOME/x", HOME)).toBe("/home/me/x");
    expect(expandTilde("$HOME", HOME)).toBe(HOME);
  });
  test("absolute paths pass through untouched", () => {
    expect(expandTilde("/abs/path", HOME)).toBe("/abs/path");
  });
  test("a tilde mid-string is not expanded", () => {
    expect(expandTilde("/a/~/b", HOME)).toBe("/a/~/b");
  });
});

describe("posixDirname", () => {
  test("nested path", () => {
    expect(posixDirname("nested/deep/beta/SKILL.md")).toBe("nested/deep/beta");
  });
  test("single segment has no dir", () => {
    expect(posixDirname("SKILL.md")).toBe(".");
  });
  test("trailing slash ignored", () => {
    expect(posixDirname("alpha/")).toBe(".");
  });
});

describe("posixBasename", () => {
  test("final segment", () => {
    expect(posixBasename("nested/deep/beta")).toBe("beta");
    expect(posixBasename("alpha")).toBe("alpha");
  });
  test("trailing slash ignored", () => {
    expect(posixBasename("/a/b/")).toBe("b");
  });
});

describe("posixJoin", () => {
  test("joins with single slashes", () => {
    expect(posixJoin("/root", "alpha")).toBe("/root/alpha");
  });
  test("collapses duplicate slashes and skips empties", () => {
    expect(posixJoin("/root/", "", "a/", "b")).toBe("/root/a/b");
  });
});
