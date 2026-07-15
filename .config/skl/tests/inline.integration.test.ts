// Integration test for `skl inline <ref>`: the full content bundle for pasting
// where the agent has no filesystem (a web chat). Spawns the real CLI so the
// discover → readSkillFiles → renderBundle → stdout path is exercised end to end.
//
// Two things the unit tests can't cover: that all of a multi-file skill's text
// files are inlined verbatim under <file> tags, and that a binary file is
// skipped (NUL-byte sniff) with a note on stderr while the bundle on stdout
// stays clean. The binary fixture is written at runtime — no committed blob.

import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli.ts");
const REPO = resolve(import.meta.dir, "fixtures/repo");

const runInline = (ref: string, path: string) =>
  Bun.spawnSync([process.execPath, CLI, "inline", ref, "--path", path]);

const pipeInlineTo = (ref: string, path: string, consumer: "wc -c" | "tail -c 256") =>
  Bun.spawnSync([
    "sh",
    "-c",
    `"$@" | ${consumer}`,
    "skl-inline-pipe",
    process.execPath,
    CLI,
    "inline",
    ref,
    "--path",
    path,
  ]);

describe("skl inline (real CLI)", () => {
  test("bundles a multi-file skill: every text file inlined, in order", () => {
    const out = runInline("repo/alpha", REPO);
    expect(out.exitCode).toBe(0);
    const text = out.stdout.toString();
    expect(text.startsWith('<skill name="alpha" source="repo">\n')).toBe(true);
    expect(text).toContain('<file path="SKILL.md">');
    expect(text).toContain("Body of the alpha skill.");
    expect(text).toContain('<file path="references/guide.md">');
    expect(text).toContain("A sibling reference file");
    expect(text.trimEnd().endsWith("</skill>")).toBe(true);
    // SKILL.md before its reference (skill.files order).
    expect(text.indexOf("SKILL.md")).toBeLessThan(text.indexOf("references/guide.md"));
  });

  test("unknown ref → error on stderr, exit 1, no bundle", () => {
    const out = runInline("repo/nope", REPO);
    expect(out.exitCode).toBe(1);
    expect(out.stderr.toString()).toContain('no skill named "nope"');
    expect(out.stdout.toString()).toBe("");
  });

  describe("binary skip", () => {
    let root = "";

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "skl-inline-"));
      const skill = join(root, "withbin");
      await mkdir(skill, { recursive: true });
      await writeFile(
        join(skill, "SKILL.md"),
        "---\nname: withbin\ndescription: Has a binary sibling.\n---\n\n# Withbin\n",
      );
      // A NUL byte makes it binary to the sniff (like a PNG header would).
      await writeFile(join(skill, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x00]));
    });

    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    test("skips the binary, keeps the bundle pasteable, notes it on stderr", () => {
      const out = runInline("withbin", root);
      expect(out.exitCode).toBe(0);
      const stdout = out.stdout.toString();
      expect(stdout).toContain('<file path="SKILL.md">');
      expect(stdout).not.toContain("logo.png");
      expect(out.stderr.toString()).toContain("skipped logo.png (binary)");
    });
  });

  describe("payload filtering", () => {
    let root = "";

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "skl-inline-filter-"));
      const skill = join(root, "noisy");
      await mkdir(join(skill, "__pycache__"), { recursive: true });
      await mkdir(join(skill, "node_modules/pkg"), { recursive: true });
      await mkdir(join(skill, "evals"), { recursive: true });
      await writeFile(join(skill, "SKILL.md"), "---\nname: noisy\n---\n\n# Noisy\n");
      await writeFile(join(skill, "notes.md"), "useful notes\n");
      await writeFile(join(skill, "notes.md.backup"), "backup notes\n");
      await writeFile(join(skill, "__pycache__/helper.pyc"), "bytecode cache\n");
      await writeFile(join(skill, "node_modules/pkg/index.js"), "dependency code\n");
      await writeFile(join(skill, "node_modules/pkg/SKILL.md"), "dependency skill\n");
      await writeFile(join(skill, "evals/evals.json"), "eval fixture\n");
    });

    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    test("omits filtered text files by default", () => {
      const out = runInline("noisy", root);
      expect(out.exitCode).toBe(0);
      const text = out.stdout.toString();
      expect(text).toContain('<file path="SKILL.md">');
      expect(text).toContain('<file path="notes.md">');
      expect(text).not.toContain("backup notes");
      expect(text).not.toContain("bytecode cache");
      expect(text).not.toContain("dependency code");
      expect(text).not.toContain("dependency skill");
      expect(text).not.toContain("eval fixture");
    });

    test("--all includes text files that default filters omit", () => {
      const out = Bun.spawnSync([process.execPath, CLI, "inline", "noisy", "--path", root, "--all"]);
      expect(out.exitCode).toBe(0);
      const text = out.stdout.toString();
      expect(text).toContain("backup notes");
      expect(text).toContain("bytecode cache");
      expect(text).toContain("dependency code");
      expect(text).toContain("dependency skill");
      expect(text).toContain("eval fixture");
    });
  });

  describe("large output", () => {
    let root = "";

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "skl-inline-large-"));
      const skill = join(root, "large");
      await mkdir(join(skill, "references"), { recursive: true });
      await writeFile(join(skill, "SKILL.md"), "---\nname: large\n---\n\n# Large\n");
      await writeFile(
        join(skill, "references/large.md"),
        `${"x".repeat(80 * 1024)}\nEND-OF-LARGE-REFERENCE\n`,
      );
    });

    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    test("flushes a bundle larger than 64 KiB through a shell pipe before exiting", () => {
      const count = pipeInlineTo("large", root, "wc -c");
      const tail = pipeInlineTo("large", root, "tail -c 256");
      expect(count.exitCode).toBe(0);
      expect(Number(count.stdout.toString().trim())).toBeGreaterThan(64 * 1024);
      expect(tail.exitCode).toBe(0);
      expect(tail.stdout.toString()).toContain("END-OF-LARGE-REFERENCE");
      expect(tail.stdout.toString().trimEnd().endsWith("</skill>")).toBe(true);
    });
  });
});
