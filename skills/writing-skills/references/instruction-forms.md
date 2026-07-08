# Instruction forms

How to phrase instructions so they survive contact with a model under
pressure. Form matters as much as content: the same rule phrased two ways can
produce opposite behaviour.

## Match form to failure type

Classify the baseline failure before writing a word. There are two species,
and the form that fixes one measurably backfires on the other:

**Output-shaping failures** — the agent produces the wrong *shape* of work
(wrong structure, missing sections, weak style). Fix with **positive
recipes**: show the desired form, give a worked example, state the template.
Prohibition lists backfire here — enumerating wrong shapes plants them.

**Rule-violation-under-pressure failures** — the agent knows the rule but
talks itself out of it when a competing incentive appears (deadline pressure
in the prompt, a user asking nicely, sunk cost). Fix with **prohibitions plus
a rationalisation table**: state the rule, then list the exact excuses the
agent generates — verbatim from your baseline transcripts — each with its
rebuttal:

```markdown
| You will think… | But actually… |
|---|---|
| "The test is probably flaky, skip it" | A failing test is the signal. Investigate before touching it. |
| "This case is too simple to need the check" | Simple cases are where the check is cheapest. Run it. |
```

Rationalisations are a transcript-derived tactic, not a generic template. Use
them only when baseline runs show the agent making predictable excuses; the
agent recognises its own excuse mid-generation.

## Never hedge a winning rule

Appending a nuance clause to a working instruction — "always run the
validator *(unless the change is trivial)*" — degrades it from consistent to
noisy. The clause reopens negotiation under exactly the pressure the rule
exists to resist: everything becomes "trivial" when the agent wants to skip.

Real exceptions get their own conditional on an **observable predicate**, not
a judgement word:

```markdown
# Hedged (broken): reopens negotiation
Always run the full suite before committing, unless the change is minor.

# Conditional (works): observable predicate
Run the full suite before committing. For changes that touch only *.md files,
the docs linter alone is sufficient.
```

## Explain why over shouting

All-caps MUST/NEVER/ALWAYS is a yellow flag: it usually marks a rule whose
rationale the author didn't transmit. Models follow reasoning better than
volume — a rule with its *why* generalises to cases the author didn't list,
while a bare imperative invites literal-minded compliance and creative
loopholes.

Reserve absolute language for genuine invariants — destructive operations,
security boundaries — and pair each with its concrete consequence ("never
force-push here: it destroys teammates' work"). If a skill accumulates
all-caps with every revision, the fix that's failing is the framing, not the
emphasis. Try a different metaphor, restructure the task, or check whether
you're using recipe-form on a violation problem (or vice versa).

## Degrees of freedom

Match specificity to fragility, per instruction — not one register for the
whole skill:

- **High freedom** (principles, heuristics, "prefer X when Y") for
  open-ended judgement: design, review, writing. Over-specifying railroads
  the agent into worse output than its defaults.
- **Low freedom** (exact commands, exact templates, "run exactly this, no
  extra flags") for fragile, destructive, or consistency-critical steps.
  Under-specifying these produces confident improvisation in the one place
  it's expensive.

A useful tell: if you'd trust a competent new hire's judgement on the step,
write a principle; if you'd hand them a runbook, write the runbook.

## Techniques that earn their keep

- **Name the anti-pattern.** A memorable label ("the mirror-test trap",
  "voodoo constant") gives the agent a recognition hook it can apply beyond
  the example. Unnamed failure descriptions don't stick.
- **Inoculate against the plausible-wrong belief.** Where the baseline shows
  the agent confidently holds a misconception, state the wrong explanation
  explicitly and correct it — pre-empting beats correcting.
- **Force evidence labels on generated claims.** For skills that produce
  analysis from a codebase or corpus, require a confidence vocabulary
  (Observed vs Inferred; Confirmed/Likely/Unclear). It converts confident
  hallucination into visible uncertainty.
- **Separate fact from extrapolation in knowledge/persona skills.** Forbid
  fabrication concretely: "never invent quotes; if no source matches, say
  so."
- **Worked examples over abstractions** — realistic, varied, structured
  examples beat a paragraph of qualities when the failure is output-shaping.
  Put bulky examples in routed references instead of the main body.
