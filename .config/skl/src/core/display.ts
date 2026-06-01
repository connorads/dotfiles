// Pure transforms for the shell pipeline: skills → list lines, and selected
// lines → ref tokens. `skl list` emits these lines; fzf shows them and feeds
// the chosen ones to `skl load --stdin`, which parses the ref back out.
//
// Line format: `<ref>  <description>` (ref = `source/name`, no spaces). The ref
// is the first whitespace-delimited token, so fzf's default `{1}` IS the ref
// (no --delimiter/--with-nth needed) and `linesToRefs` is a first-token split.

import type { DiscoveredSkill } from "./types.ts";

export const skillRef = (skill: DiscoveredSkill): string =>
  `${skill.source.name}/${skill.name}`;

/** Collapse any whitespace run (incl. newlines) to a single space. */
const flatten = (text: string): string => text.replace(/\s+/g, " ").trim();

export const skillToLine = (skill: DiscoveredSkill): string => {
  const ref = skillRef(skill);
  const desc = flatten(skill.description);
  return desc.length > 0 ? `${ref}  ${desc}` : ref;
};

export const skillsToLines = (skills: readonly DiscoveredSkill[]): string[] =>
  skills.map(skillToLine);

/** Extract ref tokens (first whitespace-delimited field) from selected lines. */
export const linesToRefs = (selected: readonly string[]): string[] =>
  selected
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((ref) => ref.length > 0);
