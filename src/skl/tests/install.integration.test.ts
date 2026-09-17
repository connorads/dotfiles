// Gated install integration test: proves `skl install` copies vetted local skill
// bytes into a project by delegating to the real `skills add <local-path>` - the
// `.agents/skills/<name>` copy, the Claude-only `.claude/skills/<name>` symlink,
// and a `skills-lock.json` entry with `sourceType: "local"` all appear. Also proves the
// project guards (non-work-tree, $HOME) fail cleanly before any copy.
//
// Gated on the real `skills` CLI, like the tmux tests gate on a reachable server.
// History is diverted via SKL_HISTORY_FILE so fixture installs never pollute the
// real usage log (as pipeline.integration.test.ts does).

import { expect, test, describe } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, lstatSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const skillsAvailable = (): boolean => {
  try {
    return Bun.spawnSync(["skills", "--version"]).exitCode === 0;
  } catch {
    return false;
  }
};

const CLI = resolve(import.meta.dir, "../src/cli.ts");

/** A local source fixture with one skill named `myskill`. */
const makeSource = (): string => {
  const src = mkdtempSync(join(tmpdir(), "skl-install-src-"));
  mkdirSync(join(src, "myskill"));
  writeFileSync(
    join(src, "myskill", "SKILL.md"),
    "---\nname: myskill\ndescription: A local fixture skill for skl install.\n---\n\n# myskill\n",
  );
  return src;
};

/** A git-init'd project dir. */
const makeProject = (): string => {
  const proj = mkdtempSync(join(tmpdir(), "skl-install-proj-"));
  Bun.spawnSync(["git", "-C", proj, "init"], { stdout: "ignore", stderr: "ignore" });
  return proj;
};

const historyFile = (): string =>
  join(mkdtempSync(join(tmpdir(), "skl-install-hist-")), "history.jsonl");

// skills selects the calling agent from AI_AGENT before checking inherited
// harness signals. Each subprocess declares its agent so the runner cannot
// change which project symlinks the test expects.
const runInstall = (cwd: string, args: readonly string[], agent: "claude" | "codex", home?: string) =>
  Bun.spawnSync([process.execPath, CLI, "install", ...args], {
    cwd,
    env: { ...process.env, AI_AGENT: agent, SKL_HISTORY_FILE: historyFile(), ...(home ? { HOME: home } : {}) },
  });

describe.if(skillsAvailable())("skl install (real skills CLI)", () => {
  test.each(["claude", "codex"] as const)("copies a skill and lock for %s with agent-specific symlinks", (agent) => {
    const src = makeSource();
    const proj = makeProject();

    const run = runInstall(proj, ["myskill", "--path", src], agent);
    expect(run.stderr.toString()).toBe("");
    expect(run.exitCode).toBe(0);

    const installed = join(proj, ".agents/skills/myskill/SKILL.md");
    expect(readFileSync(installed, "utf8")).toBe(readFileSync(join(src, "myskill/SKILL.md"), "utf8"));
    const claudeSkill = join(proj, ".claude/skills/myskill");
    if (agent === "claude") {
      expect(lstatSync(claudeSkill).isSymbolicLink()).toBe(true);
      expect(realpathSync(join(claudeSkill, "SKILL.md"))).toBe(realpathSync(installed));
    } else {
      expect(existsSync(claudeSkill)).toBe(false);
    }
    // Lock records a frozen local source.
    const lock = JSON.parse(readFileSync(join(proj, "skills-lock.json"), "utf8")) as {
      skills: Record<string, { sourceType: string }>;
    };
    expect(lock.skills["myskill"]?.sourceType).toBe("local");
  });

  test("guard: not inside a git work-tree → exit 1, no copy", () => {
    const src = makeSource();
    const bare = mkdtempSync(join(tmpdir(), "skl-install-bare-")); // no git init
    const run = runInstall(bare, ["myskill", "--path", src], "claude");
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("work-tree");
    expect(existsSync(join(bare, ".agents/skills/myskill"))).toBe(false);
  });

  test("guard: the work-tree root is $HOME → exit 1, refuses", () => {
    const src = makeSource();
    // A git-init'd dir posing as HOME: rev-parse returns it AND it equals HOME,
    // so the is-home guard fires (never install into the home directory).
    const fakeHome = makeProject();
    const run = runInstall(fakeHome, ["myskill", "--path", src], "claude", fakeHome);
    expect(run.exitCode).toBe(1);
    expect(run.stderr.toString()).toContain("home");
    expect(existsSync(join(fakeHome, ".agents/skills/myskill"))).toBe(false);
  });
});
