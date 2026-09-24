import { expect, test } from "bun:test";
import { NO_ORIGIN_HEAD, resolveLocal } from "./target.ts";

const dirty = { dirty: true, originHead: "origin/master" };
const clean = { dirty: false, originHead: "origin/master" };
const noOrigin = { dirty: false, originHead: null };

test("auto on a dirty tree reviews the working tree", () => {
  expect(resolveLocal({ kind: "auto" }, dirty)).toEqual({ ok: true, value: { kind: "uncommitted" } });
});

test("auto on a dirty tree needs no origin/HEAD", () => {
  expect(resolveLocal({ kind: "auto" }, { dirty: true, originHead: null }).ok).toBe(true);
});

test("auto on a clean tree reviews the branch against origin/HEAD, not main", () => {
  expect(resolveLocal({ kind: "auto" }, clean)).toEqual({
    ok: true,
    value: { kind: "branch", base: "origin/master" },
  });
});

test("auto on a clean tree without origin/HEAD is a usage error naming the fix", () => {
  const r = resolveLocal({ kind: "auto" }, noOrigin);
  expect(r).toEqual({ ok: false, error: NO_ORIGIN_HEAD });
  expect(NO_ORIGIN_HEAD).toContain("git remote set-head origin -a");
});

test("branch with an explicit base ignores origin/HEAD", () => {
  expect(resolveLocal({ kind: "branch", base: "develop" }, noOrigin)).toEqual({
    ok: true,
    value: { kind: "branch", base: "develop" },
  });
});

test("branch without a base falls back to origin/HEAD, or fails without it", () => {
  expect(resolveLocal({ kind: "branch", base: null }, clean).ok).toBe(true);
  expect(resolveLocal({ kind: "branch", base: null }, noOrigin).ok).toBe(false);
});

test("explicit targets ignore the tree state", () => {
  expect(resolveLocal({ kind: "uncommitted" }, clean)).toEqual({ ok: true, value: { kind: "uncommitted" } });
  expect(resolveLocal({ kind: "commit", sha: "abc" }, dirty)).toEqual({
    ok: true,
    value: { kind: "commit", sha: "abc" },
  });
});
