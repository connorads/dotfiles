// Pure transforms for the fzf picker: skills → tab-delimited lines, and the
// selected lines → ref tokens. Kept in the core so they're testable; only the
// fzf spawn itself (shell/fzf.ts) is untested.
//
// Line format: `<ref>\t<ref>  <description>`
//   - column 1 (ref) is the machine key, hidden via fzf --with-nth=2..
//   - column 2.. is what the user sees.

import type { DiscoveredSkill } from "./types.ts";

export const skillRef = (skill: DiscoveredSkill): string =>
  `${skill.source.name}/${skill.name}`;

/** Collapse any whitespace run (incl. newlines) to a single space. */
const flatten = (text: string): string => text.replace(/\s+/g, " ").trim();

export const skillToLine = (skill: DiscoveredSkill): string => {
  const ref = skillRef(skill);
  const desc = flatten(skill.description);
  const visible = desc.length > 0 ? `${ref}  ${desc}` : ref;
  return `${ref}\t${visible}`;
};

export const skillsToLines = (skills: readonly DiscoveredSkill[]): string[] =>
  skills.map(skillToLine);

/** Extract ref tokens (column 1) from fzf's selected lines. */
export const linesToRefs = (selected: readonly string[]): string[] =>
  selected
    .map((line) => line.split("\t")[0] ?? "")
    .filter((ref) => ref.length > 0);
