// Pure transforms for the shell pipeline: skills → list lines, and selected
// lines → ref tokens. `skl list` emits these lines; fzf shows them and feeds
// the chosen ones to `skl load --stdin`, which parses the ref back out.
//
// Line format: `<ref>  <description>` (ref = `source/name`, no spaces). The ref
// is the first whitespace-delimited token, so fzf's default `{1}` IS the ref
// (no --delimiter/--with-nth needed) and `linesToRefs` is a first-token split.

import { flatten } from "./text.ts";
import type { DiscoveredSkill } from "./types.ts";

export const skillRef = (skill: DiscoveredSkill): string =>
  `${skill.source.name}/${skill.name}`;

export const skillToLine = (skill: DiscoveredSkill): string => {
  const ref = skillRef(skill);
  const desc = flatten(skill.description);
  return desc.length > 0 ? `${ref}  ${desc}` : ref;
};

export const skillsToLines = (skills: readonly DiscoveredSkill[]): string[] =>
  skills.map(skillToLine);

// Like `skillsToLines`, but leads each source block with a folder row —
// `source/  (count)` — so the group is a first-class, selectable row in the
// picker. The folder row's first whitespace token is `source/`, so it round-
// trips through `linesToRefs` → `parseRef` → `{kind:"source"}` and `enter`/
// install on it acts on the whole group. Skills arrive source-contiguous
// (discovery preserves source order), so a block starts wherever `source.name`
// changes.
export const skillsToLinesWithFolders = (skills: readonly DiscoveredSkill[]): string[] => {
  const lines: string[] = [];
  let currentSource: string | null = null;
  for (const skill of skills) {
    if (skill.source.name !== currentSource) {
      currentSource = skill.source.name;
      const count = skills.filter((s) => s.source.name === currentSource).length;
      lines.push(`${currentSource}/  (${count})`);
    }
    lines.push(skillToLine(skill));
  }
  return lines;
};

// The folder preview pane: a header naming the group and its size, then each
// member's normal list line. Mirrors what a folder row expands to on load.
export const renderSourcePreview = (
  source: string,
  members: readonly DiscoveredSkill[],
): string => {
  const header = `${source}/  (${members.length} skill${members.length === 1 ? "" : "s"})`;
  return [header, "", ...members.map(skillToLine)].join("\n");
};

/** Extract ref tokens (first whitespace-delimited field) from selected lines. */
export const linesToRefs = (selected: readonly string[]): string[] =>
  selected
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((ref) => ref.length > 0);
