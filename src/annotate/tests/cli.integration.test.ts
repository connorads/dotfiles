// The CLI through its real seams: a real temp ANNOTATE_STATE_DIR, a real
// child process, stdin as the only way text arrives.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

let stateDir = "";

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "annotate-test-"));
});

afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const annotate = async (args: readonly string[], stdin = ""): Promise<Run> => {
  const child = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env, ANNOTATE_STATE_DIR: stateDir, HOME: "/Users/nobody" },
    stdin: stdin.length > 0 ? new TextEncoder().encode(stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
};

describe("stash", () => {
  test("takes text on stdin and reports the spool size", async () => {
    const first = await annotate(["stash", "--pane", "%12"], "hello world\n");
    expect(first.code).toBe(0);
    expect(first.stdout.trim()).toBe("annotate: stashed 1");

    const second = await annotate(["stash", "--pane", "%12"], "second\n");
    expect(second.stdout.trim()).toBe("annotate: stashed 2");
  });

  test("an empty selection is a benign no-op, not a failure", async () => {
    const run = await annotate(["stash"], "   \n\t\n");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("nothing selected");
    expect((await annotate(["count"])).stdout.trim()).toBe("0");
  });

  test("writes one JSONL event per capture", async () => {
    await annotate(["stash", "--pane", "%1"], "a\n");
    await annotate(["stash", "--pane", "%1"], "b\n");
    const log = await readFile(join(stateDir, "annotate.jsonl"), "utf8");
    const lines = log.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(JSON.parse(line).kind).toBe("stashed");
  });

  test("concurrent captures all survive", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => annotate(["stash", "--pane", `%${i}`], `excerpt ${i}\n`)),
    );
    expect((await annotate(["count"])).stdout.trim()).toBe("8");
  });
});

describe("list", () => {
  test("says so when nothing is stashed", async () => {
    const run = await annotate(["list"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("nothing stashed");
  });

  test("one row per excerpt, with pane and preview", async () => {
    await annotate(["stash", "--pane", "%12", "--cwd", "/Users/nobody/src/x"], "first line\nmore\n");
    const run = await annotate(["list"]);
    expect(run.stdout).toContain("%12");
    expect(run.stdout).toContain("~/src/x");
    expect(run.stdout).toContain("first line");
  });

  test("--json is machine-readable and keeps the text verbatim", async () => {
    await annotate(["stash", "--pane", "%12"], "  ragged\ttext  \n");
    const run = await annotate(["list", "--json"]);
    const rows = JSON.parse(run.stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("  ragged\ttext  \n");
    expect(rows[0].origin.pane).toBe("%12");
    expect(rows[0].fingerprint.sha256).toHaveLength(64);
  });
});

describe("render", () => {
  test("renders every stashed excerpt as a numbered section", async () => {
    await annotate(["stash", "--pane", "%1"], "alpha\n");
    await annotate(["stash", "--pane", "%2"], "beta\n");
    const run = await annotate(["render"]);
    expect(run.stdout).toContain("## 1 ·");
    expect(run.stdout).toContain("## 2 ·");
    expect(run.stdout).toContain("alpha");
    expect(run.stdout).toContain("beta");
  });

  test("a fenced excerpt gets a longer fence", async () => {
    await annotate(["stash", "--pane", "%1"], "```\ncode\n```\n");
    expect((await annotate(["render"])).stdout).toContain("````text");
  });
});

describe("drop and clear", () => {
  const stashThree = async (): Promise<void> => {
    await annotate(["stash", "--pane", "%1"], "one\n");
    await annotate(["stash", "--pane", "%2"], "two\n");
    await annotate(["stash", "--pane", "%3"], "three\n");
  };

  test("drop by index removes exactly that excerpt", async () => {
    await stashThree();
    const run = await annotate(["drop", "2"]);
    expect(run.code).toBe(0);
    const rows = JSON.parse((await annotate(["list", "--json"])).stdout);
    expect(rows.map((r: { text: string }) => r.text.trim())).toEqual(["one", "three"]);
  });

  test("drop last removes the newest", async () => {
    await stashThree();
    await annotate(["drop", "last"]);
    const rows = JSON.parse((await annotate(["list", "--json"])).stdout);
    expect(rows.map((r: { text: string }) => r.text.trim())).toEqual(["one", "two"]);
  });

  test("clear empties the spool", async () => {
    await stashThree();
    await annotate(["clear"]);
    expect((await annotate(["count"])).stdout.trim()).toBe("0");
  });

  test("an index past the end is a no-op that says so", async () => {
    await stashThree();
    const run = await annotate(["drop", "9"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("no excerpt 9");
    expect((await annotate(["count"])).stdout.trim()).toBe("3");
  });

  test("the log is append-only - a drop adds a line rather than removing one", async () => {
    await annotate(["stash", "--pane", "%1"], "one\n");
    await annotate(["drop", "last"]);
    const log = await readFile(join(stateDir, "annotate.jsonl"), "utf8");
    const kinds = log.trimEnd().split("\n").map((l) => JSON.parse(l).kind);
    expect(kinds).toEqual(["stashed", "dropped"]);
  });
});

describe("count and path", () => {
  test("count is a bare number, for the status pill", async () => {
    expect((await annotate(["count"])).stdout.trim()).toBe("0");
    await annotate(["stash", "--pane", "%1"], "x\n");
    expect((await annotate(["count"])).stdout.trim()).toBe("1");
  });

  test("path names the log under the state dir", async () => {
    expect((await annotate(["path"])).stdout.trim()).toBe(join(stateDir, "annotate.jsonl"));
  });
});

describe("failure modes", () => {
  test("an unknown command is exit 2 with usage on stderr", async () => {
    const run = await annotate(["frobnicate"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("unknown command");
    expect(run.stderr).toContain("annotate stash");
  });

  test("no arguments prints usage and succeeds", async () => {
    const run = await annotate([]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("annotate stash");
  });

  // The store outlives the binary, so a log holding junk must still work.
  test("a corrupt line does not take the rest of the spool with it", async () => {
    await annotate(["stash", "--pane", "%1"], "kept\n");
    const path = join(stateDir, "annotate.jsonl");
    await Bun.write(path, `${await readFile(path, "utf8")}{"kind":"stashed",TRUNCATED`);
    const run = await annotate(["list", "--json"]);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toHaveLength(1);
  });

  test("reading a state dir that does not exist yet is empty, not an error", async () => {
    const run = await annotate(["list"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("nothing stashed");
  });
});
