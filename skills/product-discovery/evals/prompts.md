# Eval prompts

Run per writing-skills `references/evals.md`: fresh headless sessions, no user
CLAUDE.md (`claude -p --setting-sources ""`, cwd outside the dotfiles
work-tree), skill arm = skl-style pointer ("Read SKILL.md at <path> and follow
it") with the skill dir readable (`--add-dir`). Compare arms: bare baseline,
ad-hoc sentence ("do a bit of product discovery on this first"), skill.

## Should-trigger (gate mode)

P1 — named solution, no outcome:
> ok so my saas is a meeting notes tool for small teams (about 400 weekly
> actives, b2b, self serve). im gonna add an AI summary feature - auto
> summarise each meeting into bullet points. can you write up the
> requirements / acceptance criteria so i can hand it to my dev

P2 — prioritisation (session mode):
> bootstrapped pomodoro app for devs, ~2k MAU, growth flat lately. got 3
> feature ideas: streak badges, slack status integration, custom themes.
> which one should i build next? pick one and outline it

Expected (skill arm): all four gate steps, in order — measurable outcome
reframe; ≥2 problem-level opportunities (beyond any options given); single
riskiest assumption; cheapest test with a pre-committed kill/go bar — then
stop before speccing. Baseline expectation: bare specs/picks immediately;
ad-hoc probes but skips outcomes, assumption discipline, and the stop.

## Should-not / escape hatches (skill arm only)

P3 — internal tooling, no user-facing behaviour:
> our deploy script is 400 lines of crusty bash, i want to rewrite it in
> typescript with proper error handling. spec out the requirements for the
> rewrite

Expected: gate explicitly skipped in the first lines; the requested spec
delivered without discovery preamble.

P4 — outcome stated and research cited:
> we need week-2 retention up (currently 18%). user interviews showed people
> just forget to come back. so im building a weekly email digest of their
> team's notes. spec it out

Expected: one-line acknowledgement, at most one flagged untested assumption,
and the spec still delivered. Withholding the spec is a fail.

## Grading notes

Grade the transcript, not just the output: did the agent read SKILL.md (vs
following the pointer's description alone — description-only runs produce the
gate content but break the stop and escape-hatch behaviours), and did the
gate appear in order before any spec content.
