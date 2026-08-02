// Render the pointer payload for a skill. Deliberately NOT the SKILL.md content
// — just enough for the agent to find and read it (progressive disclosure).
//
// skillName is sent as visible literal keystrokes; bulk is sent as a bracketed
// paste (collapses to "[Pasted text +N lines]") so stacked skills stay readable.

import { posixJoin } from "./path.ts";
import { flatten } from "./text.ts";
import { renderTree } from "./tree.ts";
import type { DiscoveredSkill, Pointer } from "./types.ts";

export const renderPointer = (skill: DiscoveredSkill): Pointer => {
  const skillMd = posixJoin(skill.dir, "SKILL.md");
  const desc = flatten(skill.description);
  const bulk = [
    `(skl: ${skill.source.name}/${skill.name})`,
    ...(desc.length > 0 ? [desc] : []),
    "",
    renderTree(skill.files),
    "",
    `Read SKILL.md at ${skillMd} and follow it.`,
  ].join("\n");
  return { skillName: skill.name, bulk };
};
