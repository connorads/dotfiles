// fzf adapter: feed the (pure) display lines, return the selected ref tokens.
// Only the spawn is untested; the line ⇄ ref transforms live in core/display.ts.
//
// Line format `<ref>\t<visible>`: column 1 (ref) is hidden via --with-nth=2..
// and used as the machine key. fzf shell-quotes {1} in the preview command.

import { skillsToLines, linesToRefs } from "../core/display.ts";
import type { DiscoveredSkill } from "../core/types.ts";

export interface PickOptions {
  /** Shell command template for the preview pane; {1} = the ref column. */
  readonly previewCmd: string;
  /** Top-down list (set when invoked from a tmux popup). */
  readonly reverse: boolean;
}

export interface PickResult {
  readonly refs: string[];
}

export const pickSkills = async (
  skills: readonly DiscoveredSkill[],
  options: PickOptions,
): Promise<PickResult> => {
  const lines = skillsToLines(skills);
  const args = [
    "--multi",
    "--delimiter=\t",
    "--with-nth=2..",
    "--preview", options.previewCmd,
    "--preview-window", "right,60%,wrap",
    "--bind", "tab:toggle+down,btab:toggle+up",
    "--header", "tab: mark · enter: load · esc: cancel",
    ...(options.reverse ? ["--reverse"] : []),
  ];
  const proc = Bun.spawn(["fzf", ...args], {
    stdin: new TextEncoder().encode(lines.join("\n")),
    stdout: "pipe",
    stderr: "inherit",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited; // exit 0 = picked, 1 = no match, 130 = cancelled
  return { refs: linesToRefs(out.split("\n")) };
};
