// Render the full inline bundle for a skill: SKILL.md plus every text file under
// its dir, wrapped in XML-ish delimiters. The deliberate INVERSE of the pointer
// (core/pointer.ts) — for a target with no filesystem access (a web chat), the
// agent can't "read SKILL.md at <path>", so the content is inlined verbatim.
//
// XML-style <file> tags, NOT ``` fences: skill files are themselves full of code
// fences, so wrapping them in more fences breaks; tags nest cleanly and the model
// parses them well. See ADR-0005.

import type { BundleFile, DiscoveredSkill } from "./types.ts";

const stripTrailingNewlines = (s: string): string => s.replace(/\n*$/, "");

export const renderBundle = (
  skill: DiscoveredSkill,
  files: readonly BundleFile[],
): string => {
  const parts = [`<skill name="${skill.name}" source="${skill.source.name}">`];
  for (const file of files) {
    parts.push(`<file path="${file.path}">\n${stripTrailingNewlines(file.content)}\n</file>`);
  }
  parts.push("</skill>");
  return parts.join("\n");
};
