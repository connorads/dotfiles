// Parse a reference token into a SkillRef. Split on the FIRST "/": everything
// before it is the source label, the rest is the (slash-free) skill name.

import type { SkillRef } from "./types.ts";

export const parseRef = (token: string): SkillRef => {
  const idx = token.indexOf("/");
  if (idx === -1) return { kind: "bare", name: token };
  return {
    kind: "qualified",
    source: token.slice(0, idx),
    name: token.slice(idx + 1),
  };
};
