// How the change reaches the reviewer. A small change is pasted inline; a
// large one is described by the read-only git commands that produce it and
// the reviewer collects it itself. Untracked files are named either way:
// `git diff` never shows them, so a change made only of new files would
// otherwise review as empty.

import type { Target } from "./types.ts";

export const INLINE_MAX_FILES = 2;
export const INLINE_MAX_BYTES = 256 * 1024;
export const UNTRACKED_INLINE_MAX_BYTES = 24 * 1024;

export interface Untracked {
  readonly path: string;
  readonly size: number;
  /** Null when binary or larger than UNTRACKED_INLINE_MAX_BYTES. */
  readonly content: string | null;
}

export interface Collected {
  /** Tracked-file diff text (for a commit, `git show` output). */
  readonly diff: string;
  /** Tracked files the diff touches. */
  readonly files: readonly string[];
  readonly untracked: readonly Untracked[];
}

export type Delivery = "inline" | "self-collect";

const bytes = (s: string): number => new TextEncoder().encode(s).length;

export const isEmpty = (c: Collected): boolean => c.diff.trim() === "" && c.untracked.length === 0;

export const chooseDelivery = (c: Collected): Delivery => {
  const files = c.files.length + c.untracked.length;
  const size = bytes(c.diff) + c.untracked.reduce((n, u) => n + u.size, 0);
  return files <= INLINE_MAX_FILES && size < INLINE_MAX_BYTES ? "inline" : "self-collect";
};

/** A code fence longer than any backtick run inside `text`. */
export const fence = (text: string, lang = ""): string => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text.endsWith("\n") ? text : `${text}\n`}${f}`;
};

export const targetLabel = (target: Target): string => {
  switch (target.kind) {
    case "uncommitted":
      return "uncommitted working-tree changes (staged, unstaged and untracked)";
    case "branch":
      return `branch HEAD against ${target.base} (merge-base ${target.mergeBase.slice(0, 12)})`;
    case "commit":
      return `commit ${target.sha}`;
    case "pr":
      return `pull request #${target.number} (head ${target.headSha.slice(0, 12)})`;
    case "plan":
      return `plan ${target.source}`;
  }
};

/** Read-only commands that reproduce the tracked diff, run from the repo root. */
export const collectCommands = (target: Target): readonly string[] => {
  switch (target.kind) {
    case "uncommitted":
      return ["git status --short --untracked-files=all", "git diff HEAD"];
    case "branch":
      return [`git log --oneline ${target.mergeBase}..HEAD`, `git diff ${target.mergeBase}..HEAD`];
    case "commit":
      return [`git show ${target.sha}`];
    case "pr":
      return [
        `git log --oneline ${target.mergeBase}..${target.headSha}`,
        `git diff ${target.mergeBase}..${target.headSha}`,
      ];
    case "plan":
      return [];
  }
};

const untrackedSection = (untracked: readonly Untracked[], inline: boolean): string => {
  if (untracked.length === 0) return "";
  const parts = ["### Untracked (new) files", "", "`git diff` does not show these. They are part of the change."];
  for (const u of untracked) {
    if (inline && u.content !== null) {
      parts.push("", `#### ${u.path}`, "", fence(u.content));
    } else {
      parts.push("", `- \`${u.path}\` (${u.size} bytes) - read it in full`);
    }
  }
  return parts.join("\n");
};

export const renderContext = (target: Target, c: Collected): string => {
  const delivery = chooseDelivery(c);
  const head = `Target: ${targetLabel(target)}`;
  if (delivery === "inline") {
    const diff = c.diff.trim() === "" ? "" : ["### Diff", "", fence(c.diff, "diff")].join("\n");
    return [head, "", diff, untrackedSection(c.untracked, true)].filter((s) => s !== "").join("\n\n");
  }
  const size = bytes(c.diff);
  const commands = collectCommands(target).map((cmd) => `- \`${cmd}\``);
  return [
    head,
    "",
    `The change is too large to inline (${c.files.length + c.untracked.length} files, ${Math.ceil(size / 1024)} KB of diff). Collect it yourself with these read-only commands, run from the repository root, then read the surrounding code:`,
    "",
    ...commands,
    "",
    untrackedSection(c.untracked, false),
  ]
    .join("\n")
    .trimEnd();
};
