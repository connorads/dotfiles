// Parse a reference token into a SkillRef. Split on the FIRST "/": everything
// before it is the source label, the rest is the (slash-free) skill name.

import type { SkillRef } from "./types.ts";

export const parseRef = (token: string): SkillRef => {
  const idx = token.indexOf("/");
  if (idx === -1) return { kind: "bare", name: token };
  const source = token.slice(0, idx);
  const name = token.slice(idx + 1);
  // Trailing slash (empty name) = the whole source, e.g. `expo/`. Backward-
  // compatible: no valid concrete ref has an empty name after the slash.
  if (name === "") return { kind: "source", source };
  return { kind: "qualified", source, name };
};
