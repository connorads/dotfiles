// send / draft / undo through their real seams: a real temp state dir, a real
// child process, $ANNOTATE_EDITOR a stub script, and a stub `agent` binary
// standing in for delivery.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

let dir = "";
let stateDir = "";
let binDir = "";
let agentLog = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "annotate-send-"));
  stateDir = join(dir, "state");
  binDir = join(dir, "bin");
  agentLog = join(dir, "agent.log");
  await Bun.write(join(binDir, ".keep"), "");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** An `agent` stub recording its argv; `AGENT_EXIT` picks the outcome. */
const writeAgentStub = async (exitCode = 0): Promise<string> => {
  const path = join(binDir, "agent");
  await writeFile(
    path,
    `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${agentLog}"
exit ${exitCode}
`,
    "utf8",
  );
  await chmod(path, 0o755);
  return path;
};

/** An editor stub: applies `script` to the file it is handed, then exits. */
const writeEditorStub = async (script: string, exitCode = 0): Promise<string> => {
  const path = join(binDir, "fake-editor");
  await writeFile(path, `#!/usr/bin/env bash\n${script}\nexit ${exitCode}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
};

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const annotate = async (
  args: readonly string[],
  options: { stdin?: string; editor?: string } = {},
): Promise<Run> => {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ANNOTATE_STATE_DIR: stateDir,
    ANNOTATE_AGENT_BIN: join(binDir, "agent"),
    HOME: "/Users/nobody",
  };
  if (options.editor !== undefined) env["ANNOTATE_EDITOR"] = options.editor;
  const child = Bun.spawn(["bun", CLI, ...args], {
    env,
    stdin:
      options.stdin !== undefined ? new TextEncoder().encode(options.stdin) : "ignore",
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

const stash = (text: string, pane = "%12"): Promise<Run> =>
  annotate(["stash", "--pane", pane], { stdin: text });

describe("send", () => {
  test("renders, edits, and delivers what was saved", async () => {
    await writeAgentStub();
    const editor = await writeEditorStub(`sed -i '' 's|<!-- your comment here -->|THIS IS WRONG|' "$1"`);
    await stash("the offending output\n");

    const run = await annotate(["send"], { editor });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("sent to agent:%12");

    const delivered = await readFile(agentLog, "utf8");
    expect(delivered).toContain("THIS IS WRONG");
    expect(delivered).toContain("the offending output");
    // The editing preamble addresses the reader, not the agent.
    expect(delivered).not.toContain("Delete a section to drop it");
  });

  test("delivers via agent prompt with the pane and a -- separator", async () => {
    await writeAgentStub();
    const editor = await writeEditorStub(`printf 'edited\\n' >> "$1"`);
    await stash("x\n", "%417");
    await annotate(["send"], { editor });

    const argv = (await readFile(agentLog, "utf8")).split("\n");
    expect(argv[0]).toBe("prompt");
    expect(argv[1]).toBe("%417");
    expect(argv[2]).toBe("--");
    // Never --force: a pane at an approval prompt would take the draft as its
    // answer, and exit 4 is the guard against exactly that.
    expect(argv).not.toContain("--force");
  });

  test("the spool is flushed and the draft cleared after a send", async () => {
    await writeAgentStub();
    const editor = await writeEditorStub(`printf 'edited\\n' >> "$1"`);
    await stash("one\n");
    await annotate(["send"], { editor });

    expect((await annotate(["count"])).stdout.trim()).toBe("0");
    expect((await annotate(["draft"])).stdout).toContain("no draft");
  });

  test("--no-edit sends the render verbatim", async () => {
    await writeAgentStub();
    await stash("verbatim output\n");
    const run = await annotate(["send", "--no-edit"]);
    expect(run.code).toBe(0);
    expect(await readFile(agentLog, "utf8")).toContain("verbatim output");
  });

  test("--dry-run prints what would go, and sends nothing", async () => {
    await writeAgentStub();
    await stash("preview me\n");
    const run = await annotate(["send", "--no-edit", "--dry-run"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("preview me");
    expect(run.stdout).toContain("would send to agent:%12");
    expect(await Bun.file(agentLog).exists()).toBe(false);
    // Nothing was consumed.
    expect((await annotate(["count"])).stdout.trim()).toBe("1");
  });

  test("an empty spool is a benign no-op", async () => {
    const run = await annotate(["send"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("nothing to send");
  });

  test("--to overrides the pane the excerpts came from", async () => {
    await writeAgentStub();
    await stash("x\n", "%1");
    await annotate(["send", "--no-edit", "--to", "%99"]);
    expect((await readFile(agentLog, "utf8")).split("\n")[1]).toBe("%99");
  });

  test("excerpts from several panes warn, and go to the most recent", async () => {
    await writeAgentStub();
    await stash("a\n", "%1");
    await stash("b\n", "%2");
    const run = await annotate(["send", "--no-edit"]);
    expect(run.stderr).toContain("%1, %2");
    expect((await readFile(agentLog, "utf8")).split("\n")[1]).toBe("%2");
  });
});

describe("the editor is the review gate", () => {
  test("a non-zero exit keeps the comments and sends nothing", async () => {
    await writeAgentStub();
    // vim's `:w` then `:cq`: save the comment, refuse to send.
    const editor = await writeEditorStub(
      `sed -i '' 's|<!-- your comment here -->|half-written thought|' "$1"`,
      1,
    );
    await stash("output\n");

    const run = await annotate(["send"], { editor });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("draft kept, nothing sent");
    expect(await Bun.file(agentLog).exists()).toBe(false);
    expect((await annotate(["draft"])).stdout).toContain("half-written thought");
  });

  // $EDITOR here is `micro`, which cannot exit non-zero on purpose, so the
  // exit code alone cannot carry "do not send". Quitting without saving must
  // still never fire an unreviewed draft at an agent.
  test("an unchanged draft is never sent", async () => {
    await writeAgentStub();
    const editor = await writeEditorStub(`true`);
    await stash("output\n");

    const run = await annotate(["send"], { editor });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("draft unchanged, nothing sent");
    expect(await Bun.file(agentLog).exists()).toBe(false);
  });

  test("deleting every section cancels cleanly", async () => {
    await writeAgentStub();
    const editor = await writeEditorStub(`: > "$1"`);
    await stash("output\n");

    const run = await annotate(["send"], { editor });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("nothing to send");
    expect(await Bun.file(agentLog).exists()).toBe(false);
  });

  test("an editor that cannot start is exit 3, with the spool intact", async () => {
    await stash("output\n");
    const run = await annotate(["send"], { editor: "/nonexistent/editor" });
    expect(run.code).toBe(3);
    expect((await annotate(["count"])).stdout.trim()).toBe("1");
  });
});

describe("a draft survives an interruption", () => {
  test("comments are kept, and excerpts stashed meanwhile are appended below", async () => {
    await writeAgentStub();
    await stash("first excerpt\n");

    // Write a comment, then abort rather than send.
    const abort = await writeEditorStub(
      `sed -i '' 's|<!-- your comment here -->|MY COMMENT|' "$1"`,
      1,
    );
    await annotate(["send"], { editor: abort });

    // Something else gets stashed while the draft sits there.
    await stash("second excerpt\n");

    const shown = (await annotate(["draft"])).stdout;
    expect(shown).toContain("MY COMMENT");
    expect(shown).toContain("second excerpt");
    // The first excerpt is rendered once, not duplicated by the re-render.
    expect(shown.match(/## 1 ·/g)).toHaveLength(1);
    expect(shown).toContain("## 2 ·");
  });

  test("draft --edit saves without sending, whatever the editor exits with", async () => {
    await writeAgentStub();
    const editor = await writeEditorStub(`printf 'a later thought\\n' >> "$1"`, 0);
    await stash("output\n");

    const run = await annotate(["draft", "--edit"], { editor });
    expect(run.code).toBe(0);
    expect(await Bun.file(agentLog).exists()).toBe(false);
    expect((await annotate(["draft"])).stdout).toContain("a later thought");
  });

  test("draft --discard bins it, leaving the spool alone", async () => {
    await stash("output\n");
    await annotate(["draft", "--edit"], { editor: await writeEditorStub(`printf 'x\\n' >> "$1"`) });
    expect((await annotate(["draft", "--discard"])).code).toBe(0);
    expect((await annotate(["count"])).stdout.trim()).toBe("1");
  });
});

describe("failed delivery leaves everything intact", () => {
  test("a pane waiting on a human is exit 4, spool and draft untouched", async () => {
    await writeAgentStub(4);
    const editor = await writeEditorStub(`printf 'comment\\n' >> "$1"`);
    await stash("output\n");

    const run = await annotate(["send"], { editor });
    expect(run.code).toBe(4);
    expect(run.stderr).toContain("waiting on you");
    expect((await annotate(["count"])).stdout.trim()).toBe("1");
    expect((await annotate(["draft"])).stdout).toContain("comment");
  });

  test("an unreachable pane is exit 3, spool intact", async () => {
    await writeAgentStub(3);
    await stash("output\n");
    const run = await annotate(["send", "--no-edit"]);
    expect(run.code).toBe(3);
    expect((await annotate(["count"])).stdout.trim()).toBe("1");
  });

  test("a stall is exit 5", async () => {
    await writeAgentStub(5);
    await stash("output\n");
    expect((await annotate(["send", "--no-edit"])).code).toBe(5);
  });
});

describe("undo", () => {
  test("restores the delivered draft verbatim, ready to re-aim", async () => {
    await writeAgentStub();
    const editor = await writeEditorStub(
      `sed -i '' 's|<!-- your comment here -->|THE CORRECTION|' "$1"`,
    );
    await stash("output\n", "%1");
    await annotate(["send"], { editor });
    const firstDelivery = await readFile(agentLog, "utf8");

    const undone = await annotate(["undo"]);
    expect(undone.code).toBe(0);
    expect((await annotate(["draft"])).stdout).toContain("THE CORRECTION");

    // Re-aimed elsewhere with nothing retyped.
    await annotate(["send", "--no-edit", "--to", "%19"]);
    const second = (await readFile(agentLog, "utf8")).split("\n");
    expect(second[1]).toBe("%19");
    expect(second.slice(3).join("\n")).toBe(firstDelivery.split("\n").slice(3).join("\n"));
  });

  test("with nothing sent yet it is a benign no-op", async () => {
    const run = await annotate(["undo"]);
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("nothing sent yet");
  });
});

describe("other destinations", () => {
  test("--file writes the draft where it is told", async () => {
    const out = join(dir, "nested", "review.md");
    await stash("output\n");
    const run = await annotate(["send", "--no-edit", "--file", out]);
    expect(run.code).toBe(0);
    expect(await readFile(out, "utf8")).toContain("output");
  });

  test("--dest file with no path is a usage-level failure, not a silent success", async () => {
    await stash("output\n");
    const run = await annotate(["send", "--no-edit", "--dest", "file"]);
    expect(run.code).toBe(3);
    expect((await annotate(["count"])).stdout.trim()).toBe("1");
  });
});
