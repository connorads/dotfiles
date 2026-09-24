// Against real throwaway repositories, not a mocked git: the snapshot and
// collection logic is only as good as its reading of git's actual output.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectUncommitted, guidanceFromDisk, snapshot } from "./git.ts";

let repo: string;

// A commit hook exports GIT_INDEX_FILE (and the dotfiles wrapper GIT_DIR and
// GIT_WORK_TREE). The code under test inherits process.env, so strip them
// here or every fixture repo would read the outer repository's index.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}

const git = (...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd: repo, env: process.env });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString();
};

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "critique-git-"));
  git("init", "-q", "-b", "master");
  git("config", "user.email", "t@users.noreply.github.com");
  git("config", "user.name", "t");
  await writeFile(join(repo, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-qm", "init");
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
});

test("a clean repo without a remote is clean with no origin/HEAD", async () => {
  expect(await snapshot(repo)).toEqual({ ok: true, value: { dirty: false, originHead: null } });
});

test("an untracked-only change is dirty and collects the new file", async () => {
  await writeFile(join(repo, "new.ts"), "export const x = 1;\n");
  const snap = await snapshot(repo);
  expect(snap.ok && snap.value.dirty).toBe(true);
  const c = await collectUncommitted(repo);
  if (!c.ok) throw new Error(c.error);
  expect(c.value.diff).toBe("");
  expect(c.value.untracked).toEqual([{ path: "new.ts", size: 20, content: "export const x = 1;\n" }]);
});

test("staged and unstaged edits both land in the diff", async () => {
  await writeFile(join(repo, "a.txt"), "two\n");
  git("add", "a.txt");
  await writeFile(join(repo, "a.txt"), "three\n");
  const c = await collectUncommitted(repo);
  if (!c.ok) throw new Error(c.error);
  expect(c.value.diff).toContain("+three");
  expect(c.value.files).toEqual(["a.txt"]);
});

test("origin/HEAD resolves when set", async () => {
  git("update-ref", "refs/remotes/origin/master", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
  expect(await snapshot(repo)).toEqual({ ok: true, value: { dirty: false, originHead: "origin/master" } });
});

test("guidance dedupes a CLAUDE.md symlinked to AGENTS.md", async () => {
  await writeFile(join(repo, "AGENTS.md"), "rules\n");
  await symlink("AGENTS.md", join(repo, "CLAUDE.md"));
  expect(await guidanceFromDisk(repo)).toEqual([{ path: "AGENTS.md", text: "rules\n" }]);
});
