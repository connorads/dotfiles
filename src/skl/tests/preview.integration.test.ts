// Integration checks for payload filtering in the real CLI preview path. The
// fixture is made at runtime so generated/cache artefacts are explicit.

import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli.ts");

const runPreview = (ref: string, path: string, extraArgs: readonly string[] = []) =>
  Bun.spawnSync([process.execPath, CLI, "preview", ref, "--path", path, ...extraArgs]);

const pipePreviewTo = (ref: string, path: string, consumer: "wc -c" | "tail -c 256") =>
  Bun.spawnSync([
    "sh",
    "-c",
    `"$@" | ${consumer}`,
    "skl-preview-pipe",
    process.execPath,
    CLI,
    "preview",
    ref,
    "--path",
    path,
  ]);

describe("skl preview payload filtering (real CLI)", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "skl-preview-"));
    const skill = join(root, "noisy");
    await mkdir(join(skill, ".claude/.cc-writes"), { recursive: true });
    await mkdir(join(skill, ".rumdl_cache/0.2.27"), { recursive: true });
    await mkdir(join(skill, "__pycache__"), { recursive: true });
    await mkdir(join(skill, ".git"), { recursive: true });
    await mkdir(join(skill, "node_modules/pkg"), { recursive: true });
    await mkdir(join(skill, "evals"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: noisy\n---\n\n# Noisy\n");
    await writeFile(join(skill, "references.md"), "useful reference\n");
    await writeFile(join(skill, "SKILL.md.backup"), "backup copy\n");
    await writeFile(join(skill, ".claude/.cc-writes/state.json"), "{}\n");
    await writeFile(join(skill, ".rumdl_cache/workspace_index.bin"), "cache index\n");
    await writeFile(join(skill, ".DS_Store"), "finder data\n");
    await writeFile(join(skill, ".git/config"), "git internals\n");
    await writeFile(join(skill, "__pycache__/helper.pyc"), "bytecode cache\n");
    await writeFile(join(skill, "node_modules/pkg/index.js"), "dependency code\n");
    await writeFile(join(skill, "node_modules/pkg/SKILL.md"), "dependency skill\n");
    await writeFile(join(skill, "evals/evals.json"), "{}\n");
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("hides filtered payload files by default", () => {
    const out = runPreview("noisy", root);
    expect(out.exitCode).toBe(0);
    const text = out.stdout.toString();
    expect(text).toContain("SKILL.md");
    expect(text).toContain("references.md");
    expect(text).not.toContain("SKILL.md.backup");
    expect(text).not.toContain(".claude");
    expect(text).not.toContain(".rumdl_cache");
    expect(text).not.toContain(".DS_Store");
    expect(text).not.toContain(".git");
    expect(text).not.toContain("__pycache__");
    expect(text).not.toContain("node_modules");
    expect(text).not.toContain("evals");
  });

  test("--all shows filtered payload files", () => {
    const out = runPreview("noisy", root, ["--all"]);
    expect(out.exitCode).toBe(0);
    const text = out.stdout.toString();
    expect(text).toContain("SKILL.md.backup");
    expect(text).toContain(".claude");
    expect(text).toContain(".rumdl_cache");
    expect(text).toContain(".DS_Store");
    expect(text).toContain(".git");
    expect(text).toContain("__pycache__");
    expect(text).toContain("node_modules");
    expect(text).toContain("evals");
  });
});

describe("skl preview large output (real CLI)", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "skl-preview-large-"));
    const skill = join(root, "large");
    const references = join(skill, "references");
    await mkdir(references, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: large\n---\n\n# Large\n");
    await Promise.all(
      Array.from({ length: 1_200 }, (_, index) =>
        writeFile(
          join(references, `reference-${String(index).padStart(4, "0")}-${"x".repeat(32)}.md`),
          "",
        ),
      ),
    );
  });

  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("flushes a pointer larger than 64 KiB through a shell pipe before exiting", () => {
    const count = pipePreviewTo("large", root, "wc -c");
    const tail = pipePreviewTo("large", root, "tail -c 256");
    expect(count.exitCode).toBe(0);
    expect(Number(count.stdout.toString().trim())).toBeGreaterThan(64 * 1024);
    expect(tail.exitCode).toBe(0);
    expect(tail.stdout.toString()).toContain(`reference-1199-${"x".repeat(32)}.md`);
    expect(tail.stdout.toString()).toContain("Read SKILL.md at ");
    expect(tail.stdout.toString().trimEnd().endsWith("SKILL.md and follow it.")).toBe(true);
  });
});
