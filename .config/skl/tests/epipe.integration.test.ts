// A downstream reader closing the pipe early (`head`, fzf on Esc in bin/pick)
// is normal for a lister. Bun emits the EPIPE asynchronously as a stream
// 'error' event, so without a handler it becomes an uncaught error: raw stack
// on stderr, exit 1. This proves skl exits 0 and stays silent instead.
//
// The generated fixture is large on purpose: list output must exceed the
// 64 KiB pipe buffer so the writer is still blocked when `head` exits,
// making the EPIPE deterministic. The 3-skill static fixture is too small.

import { expect, test, beforeAll } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/cli.ts");

let fixtureDir = "";

beforeAll(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), "skl-epipe-"));
  const description = "long description ".repeat(90).trim(); // ~1.5 KB
  for (let i = 0; i < 100; i++) {
    const dir = join(fixtureDir, `skill-${String(i).padStart(3, "0")}`);
    mkdirSync(dir);
    await Bun.write(
      join(dir, "SKILL.md"),
      `---\nname: skill-${i}\ndescription: ${description}\n---\n\n# Skill ${i}\n`,
    );
  }
});

test("skl list survives the reader closing the pipe early", () => {
  const out = Bun.spawnSync([
    "sh",
    "-c",
    'set -o pipefail; "$0" "$1" list --path "$2" | head -1 > /dev/null',
    process.execPath,
    CLI,
    fixtureDir,
  ]);
  expect(out.stderr.toString()).toBe("");
  expect(out.exitCode).toBe(0);
});
