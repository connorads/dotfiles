// The transcript source: quote what a message actually said, not what fitted
// on screen.
//
// Resolution goes through `claude-session-resolve.py` rather than reading the
// pid registry here. That script already owns config-dir discovery and the
// whole fallback ladder - registry fast path (~/.claude/sessions/<pid>.json),
// then launch-args, then open-file and content matching - and it resolved 4/4
// live panes in 62-127ms. `ccp` profiles keep their own registries, which the
// resolver reaches via --config-dir; that is enrichment, not correctness.

import { emptyOrigin } from "../../core/excerpt.ts";
import { err, ok, type Result } from "../../core/result.ts";
import { findEntry, parseTranscript, transcriptPath, type Transcript } from "../../core/transcript.ts";
import { panePid } from "../tmux.ts";
import { enrich } from "./enrich.ts";
import type { Capture, SourceError, SourceRequest } from "./index.ts";

const resolverPath = (): string =>
  process.env["CLAUDE_SESSION_RESOLVER"] ??
  `${process.env["HOME"] ?? ""}/.config/tmux/scripts/claude-session-resolve.py`;

const configDir = (): string =>
  process.env["CLAUDE_CONFIG_DIR"] ?? `${process.env["HOME"] ?? ""}/.claude`;

export interface ResolvedSession {
  readonly sessionId: string;
  readonly cwd: string;
}

/** Ask the resolver which session a pane's process belongs to. */
export const resolveSession = async (
  pid: string,
  pane: string | null,
): Promise<ResolvedSession | null> => {
  const args = [resolverPath(), "--pid", pid, "--format", "json"];
  if (pane !== null) args.push("--pane", pane);

  let stdout: string;
  let code: number;
  try {
    const child = Bun.spawn(args, { stdout: "pipe", stderr: "ignore" });
    [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  } catch {
    return null;
  }
  if (code !== 0) return null;

  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (parsed["status"] !== "resolved") return null;
    const sessionId = parsed["sessionId"];
    const cwd = parsed["cwd"];
    if (typeof sessionId !== "string" || typeof cwd !== "string") return null;
    return { sessionId, cwd };
  } catch {
    return null;
  }
};

/** The parsed transcript for a pane, or why it could not be read. */
export const transcriptFor = async (
  pane: string,
): Promise<Result<{ transcript: Transcript; session: ResolvedSession }, SourceError>> => {
  const pid = await panePid(pane);
  if (pid === null) {
    return err({ kind: "unresolvable", message: `cannot read pane ${pane}` });
  }

  const session = await resolveSession(pid, pane);
  if (session === null) {
    return err({
      kind: "unresolvable",
      message: `no Claude session for ${pane} (transcript capture is Claude-only)`,
    });
  }

  const path = transcriptPath(configDir(), session.cwd, session.sessionId);
  let text: string;
  try {
    text = await Bun.file(path).text();
  } catch {
    return err({ kind: "unresolvable", message: `cannot read transcript ${path}` });
  }
  return ok({ transcript: parseTranscript(text), session });
};

export const openTranscript = async (
  request: SourceRequest,
): Promise<Result<Capture, SourceError>> => {
  const pane = request.pane;
  if (pane === null) {
    return err({ kind: "unresolvable", message: "the transcript source needs --pane" });
  }
  const entryId = request.entry;
  if (entryId === null) {
    return err({ kind: "unresolvable", message: "the transcript source needs --entry <uuid>" });
  }

  const read = await transcriptFor(pane);
  if (!read.ok) return read;

  const entry = findEntry(read.value.transcript, entryId);
  if (entry === null) {
    return err({ kind: "unresolvable", message: `no transcript entry ${entryId}` });
  }

  const origin = await enrich(emptyOrigin("transcript"), {
    ...request,
    // The resolver knows the session's real cwd; prefer it over the pane's,
    // which can have moved since the agent started.
    cwd: request.cwd ?? read.value.session.cwd,
  });
  // Stored verbatim at capture time, which is the whole of untruncation.
  return ok({ text: entry.text, origin });
};
