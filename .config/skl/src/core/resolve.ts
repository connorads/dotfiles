// Resolve a SkillRef against the discovered skills. The skills list is assumed
// to be in config precedence order (source order, then sorted within a source),
// so the FIRST match for a bare name is the precedence winner (PATH semantics).

import { ok, err, type Result } from "./result.ts";
import { parseRef } from "./ref.ts";
import type { DiscoveredSkill, ResolveError, SkillRef } from "./types.ts";

export const resolveRef = (
  ref: SkillRef,
  skills: readonly DiscoveredSkill[],
): Result<DiscoveredSkill, ResolveError> => {
  // A source group ref resolves to many skills, not one — single-skill callers
  // (preview/inline) reject it. The picker never sends one (its rows are concrete).
  if (ref.kind === "source") return err({ kind: "expects-skill", source: ref.source });

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

// Resolve a whole-source group ref to all its members, in discovery (precedence)
// order. No member = the source is unknown (nothing discovered under that label).
export const resolveSourceRef = (
  source: string,
  skills: readonly DiscoveredSkill[],
): Result<DiscoveredSkill[], ResolveError> => {
  const members = skills.filter((s) => s.source.name === source);
  if (members.length === 0) return err({ kind: "source-unknown", source });
  return ok(members);
};

// All-or-nothing batch resolution: parse and resolve every ref, short-circuiting
// to `err` on the first failure. A source group ref (trailing slash) expands to
// its members in place. Lets the shell resolve a whole batch up front (an impureim
// sandwich) so a bad ref aborts BEFORE any injection — no partial injection.
// Pure: parseRef/resolveRef do no I/O.
export const resolveRefs = (
  refs: readonly string[],
  skills: readonly DiscoveredSkill[],
): Result<DiscoveredSkill[], ResolveError> => {
  const resolved: DiscoveredSkill[] = [];
  for (const ref of refs) {
    const parsed = parseRef(ref);
    if (parsed.kind === "source") {
      const members = resolveSourceRef(parsed.source, skills);
      if (!members.ok) return members;
      resolved.push(...members.value);
      continue;
    }
    const result = resolveRef(parsed, skills);
    if (!result.ok) return result;
    resolved.push(result.value);
  }
  return ok(resolved);
};
