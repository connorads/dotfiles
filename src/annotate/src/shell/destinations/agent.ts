// Delivery into an agent pane, via `agent prompt`.
//
// `agent prompt` already owns the hard parts: it buffer-pastes the body so a
// multi-line draft arrives as one paste, settles, then submits with a separate
// keystroke (pasting text and Enter together races bracketed paste and the TUI
// swallows the submit), and it verifies the agent actually started.
//
// Its exit codes are this project's exit codes, so they pass straight through:
// 3 unresolvable, 4 refused, 5 stall.
//
// `--force` is never passed. A pane at an approval or trust prompt will take
// the draft as its answer - a fresh Codex pane sitting at "Do you trust the
// contents of this directory?" would have swallowed one whole - and exit 4 is
// the guard against exactly that. Surface it as "that pane is waiting on you",
// never as something to retry.

import { err, ok, type Result } from "../../core/result.ts";
import type { Delivery, DeliveryError, DeliveryRequest } from "./index.ts";

/** Resolved rather than assumed: the tmux server's PATH lacks ~/.local/bin. */
const agentBin = (): string =>
  process.env["ANNOTATE_AGENT_BIN"] ?? `${process.env["HOME"] ?? ""}/.local/bin/agent`;

export const deliverToAgent = async (
  request: DeliveryRequest,
): Promise<Result<Delivery, DeliveryError>> => {
  const pane = request.pane;
  if (pane === null) {
    return err({
      kind: "unresolvable",
      message: "no target pane - name one with --to %N",
    });
  }

  let code: number;
  let stderr: string;
  try {
    const child = Bun.spawn([agentBin(), "prompt", pane, "--", request.markdown], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  } catch (cause) {
    return err({
      kind: "unresolvable",
      message: `cannot run agent: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }

  const detail = stderr.trim();
  switch (code) {
    case 0:
      return ok({ destination: `agent:${pane}` });
    case 4:
      return err({
        kind: "refused",
        message: `${pane} is waiting on you - answer it, then send again${suffix(detail)}`,
      });
    case 5:
      return err({
        kind: "stall",
        message: `delivered to ${pane}, but it never started${suffix(detail)}`,
      });
    default:
      return err({
        kind: "unresolvable",
        message: `cannot reach ${pane}${suffix(detail)}`,
      });
  }
};

const suffix = (detail: string): string => (detail.length > 0 ? ` (${detail})` : "");
