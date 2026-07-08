---
name: writing-skills
description: >-
  Guides creating, editing, reviewing, and debugging Agent Skills and SKILL.md
  directories. Use when writing a new skill, improving or reviewing an existing
  skill, fixing a skill description or frontmatter, structuring references,
  scripts, assets or evals, packaging a skill, or diagnosing a skill that does
  not trigger or does not change agent behaviour. Covers portable Agent Skills
  spec, progressive disclosure, eval design, and client compatibility notes.
  Not for using an existing skill to perform its domain task.
---

# Writing Skills

A skill is a debugging tool for agent behaviour, not documentation. Everything
here reduces to one question:

> **What does the agent get wrong without this skill — and how will I know
> it's fixed?**

A skill earns every token only by changing what the agent does. A sentence
that doesn't change behaviour costs context in every future session and earns
nothing. When any decision below feels unclear, return to the question.

## Is a skill the right tool?

Three mechanisms overlap; pick by trigger, not habit:

- **Skill** — procedural knowledge loaded when the *agent decides* the task
  matches. Triggering is a heuristic: it both over- and under-fires.
- **Command / explicit prompt** — a deterministic, *user-invoked* step. If
  something must happen every time, a skill's trigger heuristic is the wrong
  enforcement mechanism.
- **Tool / MCP** — external capability or connectivity, not knowledge.

The cheapest fix is often not writing a skill at all.

## The loop

1. **Watch it fail** — run the task without the skill, capture failures verbatim
2. **Draft the minimum** that addresses those failures
3. **Test** — eval mode or exploratory mode
4. **Read the transcripts**, not just the outputs
5. **Revise** — feed gaps back; prune as deliberately as you add
6. **Re-test**; stop on convergence

One invariant holds the loop together: **no instruction without a failing
observation**. It stops you documenting imagined problems, and it gives every
line in the skill a reason you can point to when deciding later whether to
keep it.

### 1. Watch it fail

Run the real task in a fresh session *without* the skill (when editing an
existing skill: with the current version). Copy the failures — and the agent's
rationalisations for them — verbatim. These quotes are the strongest
justification any instruction can cite, and they become your first test cases.

While you have the failures in front of you, classify them: is the agent
producing the *wrong shape of output*, or *breaking a rule under pressure*?
The two need opposite instruction forms — read
[references/instruction-forms.md](references/instruction-forms.md) before
drafting if the answer isn't obvious.

### 2. Draft the minimum

Write the **description first** — it alone decides whether the body is ever
read, which makes it the highest-leverage sentence in the skill. Read
[references/description.md](references/description.md) when writing or
debugging one.

Then draft the body against the observed failures, applying these tests to
every sentence:

- **"Can I assume the model knows this?"** If yes, delete it. Gotchas,
  non-obvious edge cases, house conventions, and exact tool invocations are
  the high-signal content; general knowledge is padding.
- **Standing rules, not one-time steps.** The body enters the conversation
  once and persists; the agent doesn't re-read the file later. Phrase
  guidance that should apply throughout as an ongoing rule, not an action to
  perform now.
- **Timeless present tense.** Version numbers, prices, release dates, and
  dated change-history framing rot faster than the rules they decorate — and
  stale facts read as authoritative. State the current rule plainly; point at
  live sources (`--help`, official docs) for anything volatile.
- **One source of truth.** Any rule, table, or protocol lives in exactly one
  file; every other mention is a one-line pointer. Duplication drifts as the
  skill evolves and inflates a rule's apparent importance.
- **One default with an escape hatch**, not a menu of equal options — menus
  make the agent waste steps choosing. Use one consistent term for each
  concept throughout.

Anchor the skill on a single mental model or question stated up front (as this
file does). A checklist covers the cases you listed; a north star lets the
agent resolve cases you didn't.

Structure follows the three loading levels — metadata (always in context),
SKILL.md body (loaded on trigger), bundled files (loaded on demand):

- Keep the body lean; push depth into `references/` behind a routing line or
  table that says *when* to read each file ("when the task involves X, read
  Y") — a generic "see references/" never fires.
- Bundle a script in `scripts/` when you observe the agent reinventing the
  same deterministic logic across runs; mark whether it's to EXECUTE or to
  read as reference. Give scripts clear CLI arguments, check dependencies,
  prefer structured output when another step consumes it, and make errors
  actionable enough for the agent to recover.
- Match specificity to fragility: prose and principles for judgement calls;
  exact commands ("run exactly this, no extra flags") for fragile,
  destructive, or consistency-critical operations. Calibrate each part of a
  mixed skill independently.

Spec rules for frontmatter, naming, and layout are in
[references/spec-and-packaging.md](references/spec-and-packaging.md) — read it
before first shipping rather than mid-draft.

### 3. Test

Two lanes, same shape, different rigour:

- **Eval mode** — write realistic prompts (messy, specific, the kind a real
  user types — clean sanitised prompts hide triggering failures). Run each
  with-skill and baseline (no skill, or the old version) in **fresh sessions**,
  in parallel where the environment allows. Keep a held-out validation slice
  for description changes so trigger wording doesn't overfit the first misses.
  Read [references/evals.md](references/evals.md) for the full harness.
- **Exploratory mode (human-reviewed)** — iterate live with the user on real
  tasks when the output is subjective or the user prefers a conversational
  loop. Capture the outputs and feedback; the human review is the eval.

Fresh sessions matter in both lanes: leftover authoring context masks exactly
the gaps you're testing for.

### 4. Read the transcripts, not just the outputs

A skill can produce the right final answer while wasting steps, ignoring its
bundled scripts, or following the description instead of the body. Grade *how*
the agent got there. Prefer deterministic trace checks when available: skill
invoked, files touched, commands run, and expected order. Record token cost and
wall time; grade token cost as a context trade-off, and treat wall time as
informational because machines vary. Two signals to hunt for:

- Sections the agent read but that changed nothing → candidates for deletion.
- Work the agent reinvented identically across runs → candidate for a bundled
  script.

### 5. Revise

Feed each observed gap back as a targeted edit, and resist the accretion
instinct: adding feels safe and removing feels risky, so skills rot by
growth. Every revision should ask what can be deleted — no-op sentences,
duplicated rules, hedged clauses — with the same energy it asks what's
missing.

When a fix won't stick, don't escalate to shouting (all-caps, bold, MUST).
Reframe: explain the why, try a different metaphor, or restructure the task —
[references/instruction-forms.md](references/instruction-forms.md) covers
which forms work for which failures, and why hedging a working rule breaks it.

### 6. Re-test and stop

Re-run the same prompts in fresh sessions. Convergence across runs means the
wording is tight — ship. High variance means the instruction is ambiguous —
tighten and repeat. Stop when the user is happy, the feedback is empty, or
iterations stop moving the needle.

After shipping: every real-world "it didn't trigger" or "it did the wrong
thing" report becomes a permanent test case before you fix it.

## Ship checklist

Run `scripts/check.sh <skill-dir>` (EXECUTE) — it validates frontmatter
against the spec's closed field set and greps for the common hygiene failures:
shipped caches, orphaned files, doc-rot phrasing, long references without a
contents list. Then verify the things a script can't:

- Description states what *and* when, with the trigger words users actually
  type — and doesn't summarise the workflow.
- Every bundled file is reachable from SKILL.md; references are one level
  deep from the skill root.
- No machine-specific paths; bundled scripts are referenced relative to the
  skill directory. Any required binary is checked for, with a portable
  fallback.
- Bundled scripts and resources are reviewed as executable or instructive
  content: flag network access, broad filesystem access, secret handling, or
  any path that could move data outside the user's intent.
- The skill's executable claims — commands, flags, type names, API fields —
  are spot-checked against the live tool. Craft review alone ships domain
  bugs: a skill can be structurally perfect while its first example errors.
  "Couldn't verify" is only true after `command -v <tool>` fails; run that
  check before writing it.
- The skill has one coherent responsibility and names its boundaries with
  neighbouring skills ("this begins where X ends") when they could collide.

`tests/check.bats` covers the checker CLI contract; run it after changing
`scripts/check.sh`.

## References

| When the task involves… | Read |
|---|---|
| Writing or debugging a description / skill not triggering | [references/description.md](references/description.md) |
| Choosing instruction form, tone, degrees of freedom; a rule the agent keeps breaking | [references/instruction-forms.md](references/instruction-forms.md) |
| Running the eval harness: prompts, baselines, grading, micro-testing wording | [references/evals.md](references/evals.md) |
| Frontmatter fields, naming, layout, packaging, validation | [references/spec-and-packaging.md](references/spec-and-packaging.md) |

`evals/` holds this skill's own test prompts, fixture templates, and assertions
— run them per [references/evals.md](references/evals.md) when revising this
skill.
