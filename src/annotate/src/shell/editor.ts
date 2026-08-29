// The review step: hand the draft to $EDITOR and take back exactly what was
// saved. Not a port - there is one implementation, and the test seam is
// $ANNOTATE_EDITOR pointing at a stub on PATH.
//
// Why the editor is the only review gate: Claude collapses a pasted draft to
// `[Pasted text #1 +29 lines]` in its input box at only 29 lines, so every
// draft will collapse and none can be eyeballed at the moment of sending.
// Codex does the opposite and expands the whole thing inline. Neither is a
// place to review, which is why `--no-edit` stays an explicit opt-out.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type EditOutcome =
  /** Saved, and changed. Deliver this. */
  | { readonly kind: "edited"; readonly markdown: string }
  /**
   * Editor exited non-zero - vim's `:cq`, after a `:w` to keep the comments.
   * Whatever reached the file is kept as the draft, but nothing is delivered.
   */
  | { readonly kind: "aborted"; readonly markdown: string }
  /**
   * Came back byte-identical to what was written. Covers `:q!` and any editor
   * with no `:cq` at all - $EDITOR here is `micro`, which cannot exit
   * non-zero on purpose - so quitting without saving never fires an
   * uncommented draft at an agent. Deliberate send-verbatim is `--no-edit`.
   */
  | { readonly kind: "unchanged"; readonly markdown: string }
  /** The editor could not be started. */
  | { readonly kind: "failed"; readonly message: string };

/**
 * Open `markdown` in $EDITOR and report what came back.
 *
 * The editor inherits this process's stdio, so it owns the real tty - which
 * is why `send` is bound to a float rather than a popup.
 */
export const edit = async (markdown: string, editor: string): Promise<EditOutcome> => {
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), "annotate-draft-"));
  } catch (cause) {
    return { kind: "failed", message: describe(cause) };
  }
  // `.md` so the editor picks markdown syntax and the fences highlight.
  const path = join(dir, "annotate.md");

  try {
    await writeFile(path, markdown, "utf8");

    // Split on whitespace so `EDITOR="code -w"` works, which is the form the
    // variable conventionally takes.
    const argv = editor.trim().split(/\s+/).filter((part) => part.length > 0);
    const command = argv[0];
    if (command === undefined) return { kind: "failed", message: "no editor set" };

    let code: number;
    try {
      const child = Bun.spawn([command, ...argv.slice(1), path], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      code = await child.exited;
    } catch (cause) {
      return { kind: "failed", message: `cannot run ${command}: ${describe(cause)}` };
    }

    const saved = await readFile(path, "utf8");
    if (code !== 0) return { kind: "aborted", markdown: saved };
    if (saved === markdown) return { kind: "unchanged", markdown: saved };
    return { kind: "edited", markdown: saved };
  } catch (cause) {
    return { kind: "failed", message: describe(cause) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const describe = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
