// Resolve a SkillRef against the discovered skills. The skills list is assumed
// to be in config precedence order (source order, then sorted within a source),
// so the FIRST match for a bare name is the precedence winner (PATH semantics).

import { ok, err, type Result } from "./result.ts";
import type { DiscoveredSkill, ResolveError, SkillRef } from "./types.ts";

export const resolveRef = (
  ref: SkillRef,
  skills: readonly DiscoveredSkill[],
): Result<DiscoveredSkill, ResolveError> => {
  if (ref.kind === "bare") {
    const match = skills.find((s) => s.name === ref.name);
    if (match === undefined) return err({ kind: "not-found", name: ref.name });
    return ok(match);
  }

  const knownSource = skills.some((s) => s.source.name === ref.source);
  if (!knownSource) return err({ kind: "source-unknown", source: ref.source });

  const match = skills.find(
    (s) => s.source.name === ref.source && s.name === ref.name,
  );
  if (match === undefined) return err({ kind: "not-found", name: ref.name });
  return ok(match);
};
