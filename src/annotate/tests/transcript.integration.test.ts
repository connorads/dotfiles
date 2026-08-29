// The transcript source end to end, with `claude-session-resolve.py` stubbed
// on PATH and a real transcript file on disk. The resolver's own behaviour is
// covered by its own suite; what matters here is that annotate reads it
// correctly and stores the untruncated text.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const FIXTURE = join(import.meta.dir, "fixtures", "transcript.jsonl");

const SESSION = "5617bdea-35f0-4943-9675-44a537ad6da8";
const CWD = "/Users/me/proj";
const SLUG = "-Users-me-proj";

let dir = "";
let stateDir = "";
let configDir = "";
let resolver = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "annotate-transcript-"));
  stateDir = join(dir, "state");
  configDir = join(dir, "claude");
  resolver = join(dir, "resolve.py");

  // The transcript where annotate derives it should be.
  const projectDir = join(configDir, "projects", SLUG);
  await mkdir(projectDir, { recursive: true });
  await copyFile(FIXTURE, join(projectDir, `${SESSION}.jsonl`));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A resolver stub. `status` picks resolved vs not-found. */
const writeResolver = async (status: "resolved" | "unresolved"): Promise<void> => {
  const body =
    status === "resolved"
      ? JSON.stringify({ status: "resolved", pid: 1, sessionId: SESSION, cwd: CWD, source: "registry" })
      : JSON.stringify({ status: "not-found", pid: 1 });
  await writeFile(resolver, `#!/usr/bin/env bash\ncat <<'JSON'\n${body}\nJSON\n`, "utf8");
  await chmod(resolver, 0o755);
};

/** A tmux stub answering the one query the source makes: `#{pane_pid}`. */
const writeTmuxStub = async (paneExists: boolean): Promise<string> => {
  const binDir = join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const path = join(binDir, "tmux");
  await writeFile(
    path,
    `#!/usr/bin/env bash
# display-message -p -t <pane> -F <format>
for arg in "$@"; do
  case "$arg" in
    '#{pane_pid}') ${paneExists ? 'printf "4242\\n"' : 'printf "\\n"'} ; exit 0 ;;
  esac
done
${paneExists ? 'printf "%%1\\u001f0\\u001f/Users/me/proj\\u001fclaude\\u001f\\n"' : 'printf "\\n"'}
exit 0
`,
    "utf8",
  );
  await chmod(path, 0o755);
  return binDir;
};

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const annotate = async (args: readonly string[], binDir: string): Promise<Run> => {
  const child = Bun.spawn(["bun", CLI, ...args], {
    env: {
      ...(process.env as Record<string, string>),
      PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      ANNOTATE_STATE_DIR: stateDir,
      CLAUDE_SESSION_RESOLVER: resolver,
      CLAUDE_CONFIG_DIR: configDir,
      HOME: "/Users/nobody",
    },
    stdin: "ignore",
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

describe("entries", () => {
  test("lists the quotable turns, uuid hidden in field 1", async () => {
    await writeResolver("resolved");
    const binDir = await writeTmuxStub(true);

    const run = await annotate(["entries", "--pane", "%1"], binDir);
    expect(run.code).toBe(0);
    const rows = run.stdout.trimEnd().split("\n");
    expect(rows).toHaveLength(4);
    expect(rows[0]?.split("\t")[0]).toBe("u1");
    expect(rows[0]).toContain("you");
  });

  test("--json carries the full text of each turn", async () => {
    await writeResolver("resolved");
    const binDir = await writeTmuxStub(true);

    const run = await annotate(["entries", "--pane", "%1", "--json"], binDir);
    const entries = JSON.parse(run.stdout);
    expect(entries).toHaveLength(4);
    expect(entries.map((e: { uuid: string }) => e.uuid)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  test("a pane with no Claude session is exit 3, and says why", async () => {
    await writeResolver("unresolved");
    const binDir = await writeTmuxStub(true);

    const run = await annotate(["entries", "--pane", "%1"], binDir);
    expect(run.code).toBe(3);
    expect(run.stderr).toContain("no Claude session");
  });

  test("a pane that is gone is exit 3", async () => {
    await writeResolver("resolved");
    const binDir = await writeTmuxStub(false);

    const run = await annotate(["entries", "--pane", "%999"], binDir);
    expect(run.code).toBe(3);
    expect(run.stderr).toContain("cannot read pane");
  });
});

describe("stashing a transcript entry", () => {
  // The check that justifies the transcript source existing: the screen shows
  // `… +42 lines`, and this is the whole 60.
  test("stores the untruncated text, not the screenful", async () => {
    await writeResolver("resolved");
    const binDir = await writeTmuxStub(true);

    const run = await annotate(
      ["stash", "--source", "transcript", "--pane", "%1", "--entry", "a2"],
      binDir,
    );
    expect(run.code).toBe(0);

    const rows = JSON.parse((await annotate(["list", "--json"], binDir)).stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0].text.split("\n")).toHaveLength(60);
    expect(rows[0].text).toContain("detail line 60");
    expect(rows[0].text).not.toContain("+42 lines");
    expect(rows[0].origin.kind).toBe("transcript");
    expect(rows[0].origin.entryId).toBe("a2");
  });

  test("a multi-block turn keeps thinking and tool_use, labelled", async () => {
    await writeResolver("resolved");
    const binDir = await writeTmuxStub(true);
    await annotate(["stash", "--source", "transcript", "--pane", "%1", "--entry", "a1"], binDir);

    const rows = JSON.parse((await annotate(["list", "--json"], binDir)).stdout);
    expect(rows[0].text).toContain("[thinking]");
    expect(rows[0].text).toContain("[tool_use: Edit]");
  });

  test("an entry that is not there is exit 3, with nothing stashed", async () => {
    await writeResolver("resolved");
    const binDir = await writeTmuxStub(true);

    const run = await annotate(
      ["stash", "--source", "transcript", "--pane", "%1", "--entry", "nope"],
      binDir,
    );
    expect(run.code).toBe(3);
    expect(run.stderr).toContain("no transcript entry");
    expect((await annotate(["count"], binDir)).stdout.trim()).toBe("0");
  });

  test("the transcript source needs an entry to quote", async () => {
    await writeResolver("resolved");
    const binDir = await writeTmuxStub(true);

    const run = await annotate(["stash", "--source", "transcript", "--pane", "%1"], binDir);
    expect(run.code).toBe(3);
    expect(run.stderr).toContain("--entry");
  });

  // The source ignores stdin entirely, so a keybinding invoking it with no
  // pipe must not hang waiting on one.
  test("it never blocks on stdin", async () => {
    await writeResolver("resolved");
    const binDir = await writeTmuxStub(true);
    const run = await Promise.race([
      annotate(["stash", "--source", "transcript", "--pane", "%1", "--entry", "u1"], binDir),
      new Promise<Run>((_, reject) => setTimeout(() => reject(new Error("blocked on stdin")), 15_000)),
    ]);
    expect(run.code).toBe(0);
  });
});
