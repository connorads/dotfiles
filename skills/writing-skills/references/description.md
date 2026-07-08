# Writing the description

The description is the only part of a skill the agent sees when deciding
whether to load it. Name + description preload into every session (~100
tokens); the body loads only after the trigger decision. A vague description
means the skill silently never fires — the worst failure mode, because
nothing errors.

## The formula

Third person. State **what** the skill does, then **when** to use it, carrying
the literal words users type:

```yaml
description: >-
  Extracts screenshots and attachments from GitHub issues and PRs, including
  private repos. Use when the user shares a GitHub issue or PR URL and its
  images are needed — bug report screenshots, design attachments, error
  captures — or asks to download or view images from a GitHub link.
```

Each piece is doing trigger work:

- **What, concretely** — "extracts screenshots and attachments", not "helps
  with GitHub images".
- **When, as contexts** — the situations, artifacts, and phrasings that
  should fire it. Include colloquial variants and terms adjacent skills
  *don't* claim.
- **Negative triggers where useful** — "Not for X" fences off a near-miss
  that would otherwise mistrigger, and sharpens the boundary with a sibling
  skill.

Being slightly "pushy" is correct — agents under-trigger skills more often
than they over-trigger — but pushy means *more concrete trigger contexts*,
not adjectives.

## The failure modes

**What-only.** A description that describes capability but never says when to
use it forces the agent to infer relevance — and under competition from dozens
of other loaded descriptions, inference loses:

```yaml
# Before: what-only — agent must guess when this applies
description: Downloads images from GitHub issue and PR comments via the API.

# After: what + when + user phrasings
description: >-
  Downloads images from GitHub issue and PR comments via the API, including
  private repos. Use when the user shares a GitHub issue/PR URL and you need
  its screenshots or attachments.
```

**Workflow summary.** Never compress the skill's method into the description.
An agent that can see steps in the description may follow *them* instead of
reading the body — the description becomes a lossy substitute for the skill.
Observed failure: a description saying "reviews code in two passes" led the
agent to do its own idea of two passes without ever loading the body.
Triggers go in the description; method goes in the body.

**Body-only triggers.** A "Use when…" section in the body is invisible at
trigger time. Non-obvious *application* cues can live in the body; anything
needed to *decide to load* belongs in the description.

**Keyword stuffing without semantics.** A bare list of terms triggers on
vocabulary, not intent, and collides with neighbouring skills. Embed the
terms inside real trigger contexts.

## Sharing a catalogue

Descriptions compete. When two skills could both plausibly claim a task,
write the boundary into both descriptions ("for X use this; for Y see the
other") rather than letting the agent coin-flip. One skill = one coherent
responsibility; if the description honestly needs "and" between two unrelated
capabilities, it's two skills.

## Testing a description

Trigger accuracy is testable — realistic prompts, fresh sessions, did it
load. The harness, including should-trigger and near-miss should-NOT-trigger
sets, is in [evals.md](evals.md). Two rules of thumb carry over:

- Test with messy, specific prompts (file names, typos, backstory). Clean
  prompts trigger easily and hide real-world failures.
- Simple one-step requests often don't trigger *any* skill — agents consult
  skills for tasks they can't trivially handle. Don't burn iterations trying
  to make "read this PDF" fire a PDF skill.
