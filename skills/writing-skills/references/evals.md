# Evals

The harness for proving a skill changes behaviour. Scale it to stakes: a
personal skill might get two prompts and human review; a published skill that
fires daily deserves the full loop. Exploratory mode (human-reviewed) is
legitimate when the user wants to iterate live or the output is subjective,
but then captured outputs plus user feedback *are* the eval.

## Contents

- [Test prompts](#test-prompts)
- [Running: with-skill vs baseline](#running-with-skill-vs-baseline)
- [Grading](#grading)
- [Micro-testing wording](#micro-testing-wording)
- [Trigger testing](#trigger-testing)
- [When the loop ends](#when-the-loop-ends)

## Test prompts

Write 2–3 prompts a real user would type. Realism is the load-bearing
property — sanitised prompts pass trivially and hide the failures that matter:

- **Messy and specific**: file paths, column names, a bit of backstory,
  lowercase, abbreviations, a typo. "ok my boss sent me this xlsx (downloads,
  'Q4 final FINAL v2.xlsx'), need profit margin as a % — revenue col C, costs
  col D i think" beats "Format this spreadsheet".
- **Substantive**: agents handle trivial one-step tasks without consulting
  skills, so a too-simple prompt tests nothing.
- **Varied**: different phrasings of the intent; at least one edge case; one
  case where this skill competes with a neighbour and should win.

Every prompt is a permanent asset. Keep them with the skill (e.g. an `evals/`
dir, noted in SKILL.md so it doesn't read as an orphan). Real-world failure
reports become test cases before the fix. For trigger-description work, keep a
small validation set held out from wording edits so the description doesn't
overfit the first failures you saw.

## Running: with-skill vs baseline

For each prompt, run two fresh sessions in parallel:

- **With-skill** — the draft under test.
- **Baseline** — no skill (when creating), or the current/previous version
  (when editing; snapshot it before you start).

Fresh sessions are non-negotiable: the authoring conversation knows the
skill's intent and masks exactly the ambiguities you're hunting. Where the
environment offers subagents, spawn all runs in the same turn so they finish
together; otherwise run serially, still in clean sessions.

Capture per run: the outputs the user cares about, the full transcript, token
cost, and wall time. Token cost is a grading dimension because skill text
competes with the conversation for context. Wall time is informational because
machines and network conditions vary.

## Grading

Grade the transcript, not just the output. The questions that find revisions:

- Did the agent read the skill's references when relevant — or answer from
  the body alone? (A never-read reference may be mis-routed, or dead weight.)
- Did any section change nothing? Candidate for deletion.
- Did runs independently reinvent the same helper or multi-step dance? That's
  the signal to bundle a script.
- Can deterministic trace assertions check the process? Prefer concrete events
  where available: skill invoked, references read, commands run, files created,
  and command order.
- Did it follow the *description* instead of the body? (See
  [description.md](description.md) — the description is summarising the
  workflow.)
- Where did it rationalise around a rule? Copy the excuse verbatim into a
  rationalisation table (see
  [instruction-forms.md](instruction-forms.md)).
- Do the skill's own examples run? Commands, flags, and names a skill asserts
  are domain claims — verify a sample against the live tool. Reviewing the
  prose while trusting the claims misses exactly the bugs users hit first.

For objectively checkable outcomes, write assertions and script the check —
scripts are rerunnable across iterations and don't grade generously.
Subjective qualities (style, taste) get human review, not forced assertions.
When comparing two versions rigorously, grade blind: give a judge both
outputs unlabelled.

## Micro-testing wording

When one instruction keeps misfiring, isolate it: run the smallest task that
exercises it, 5+ fresh samples per wording variant, and read every output.

- **Convergence** across samples → the wording is tight.
- **Variance** → the instruction is ambiguous; tighten and re-sample.

Read the outputs yourself. Programmatic pass/fail on small samples overstates
success, and the *way* a variant fails tells you the next wording.

## Trigger testing

Descriptions get their own eval: ~15–20 realistic queries, mixed
should-trigger and should-not-trigger, run fresh, scored on whether the skill
loaded.

The valuable negatives are **near-misses** — queries sharing vocabulary with
the skill but needing something else. "Write a fibonacci function" as a
negative for a PDF skill tests nothing; "pull the tables out of this scanned
contract" (needs OCR, not your PDF-forms skill) tests the boundary. Run each
query more than once — triggering is stochastic, and a 2/3 trigger rate is a
different problem (ambiguous description) than 0/3 (wrong description).

Split trigger prompts into training and validation sets when tuning a
description. Use the training set to revise wording, then pick the final
wording by validation pass rate. Before shipping a description change, run at
least one held-out should-trigger prompt and one near-miss should-not-trigger
prompt.

## When the loop ends

Stop when the user says done, feedback comes back empty, or an iteration
moves nothing. Convergence across re-runs is the ship signal; variance means
tighten wording, not add more prose. Diminishing returns on the same stubborn
failure means change *form*, not intensity — see
[instruction-forms.md](instruction-forms.md).
