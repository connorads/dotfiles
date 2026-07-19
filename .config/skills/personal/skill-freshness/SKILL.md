---
name: skill-freshness
description: Sweep the authored skill catalogue for truth decay - re-verify dated caveats, version literals, counts, and executable claims against live sources, and re-baseline skills against what the model now does unaided. Use when asked to check skills for staleness, run a freshness sweep, re-verify skill claims, or after a major model upgrade; also for a single skill when revising it feels risky. Not for vendored skills (update-vendored-skills owns upstream refresh) and not a lint (writing-skills' check.sh owns phrasing).
---

# Skill Freshness

The lint owns phrasing; this sweep owns truth. A claim rots in the world, not
the text - no grep can notice that a linter count grew or a flag was renamed.
The sweep re-derives each checkable claim from its live source and proposes
fixes for whatever drifted.

Scope is the authored catalogue only: `~/skills` (public) and
`~/.config/skills/personal`. Vendored skills are upstream's problem - refresh
them via `update-vendored-skills`, never rewrite them here.

## 1 - Inventory targets

Anchor on the markers the lint deliberately tolerates:

```sh
rg -n 'current as of|as of (19|20)[0-9]{2}|last verified|verified against' \
  ~/skills ~/.config/skills/personal --glob '*.md'
```

Anchors are the floor, not the list. For each skill under review, read
SKILL.md (and any reference it leans on) and collect every *checkable* claim:
commands and flags, counts ("142 linters"), version literals, API fields,
URLs, and prices. Skip judgement content - stances and trade-offs have no
live source to check against.

## 2 - Verify against live sources

Work skill by skill; for a whole-catalogue sweep, batch ~5 skills per
subagent so claim tables never share the orchestrator's context. Per claim:

- Tool behaviour: run the command (`--help`, `<tool> builtins`, a dry run).
- Versions/counts: query the registry or installed binary, not memory.
- URLs: fetch; a redirect to a new canonical home counts as drift.
- Unverifiable here (needs auth, another OS): record "unchecked", never
  assume pass.

Verdict per claim: confirmed / drifted (with the observed value) / unchecked.

## 3 - Re-baseline against the model

Models improve underneath skills. For swept skills that bundle `evals/`, run
the eval prompts *without* the skill (fresh context) and note what the model
now does unaided - that content is retirement material, per writing-skills.
This tier is expensive: sample it (skills touched recently, or the oldest),
don't force it on every sweep.

## 4 - Propose, don't rewrite

Output one table per skill: claim, source checked, verdict, proposed fix.
Then apply the curation rule:

- Trivial verified fact (a count, a renamed flag, a moved URL - spot-checked
  live): fix directly, one commit per skill.
- Anything judgement-shaped (retiring content, restructuring, re-tiering):
  propose the diff and stop. Tier and scope are curation calls.

Prefer fixes that end the claim's rot class over refreshing its value: a
live-query pointer (`hk builtins`) beats an updated count, and a dated as-of
caveat beats an undated one.
