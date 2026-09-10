# Evaluating game-playtesting

Evaluate actual play and repair evidence, not the quality of a written test plan.

Use fresh sessions on the same frozen build, tools and declared time budget.
Compare the task alone, the task plus the advice below, and explicit invocation
of the candidate. Preserve skill snapshots and raw results outside the shipped
skill. Run interactive GPU sessions serially where concurrent rendering would
change conditions. Give each arm an isolated player profile.

Ad-hoc comparison:

> Play carefully through the real controls, reproduce problems, and retain
> concrete evidence before judging whether the game is broken.

Record full available execution traces, actual reviewed images/clips, timings,
model identity and token counters when exposed. Do not invent unavailable usage.
Audit source/hidden-state reads, direct action calls, teleports, pauses and
simulation changes. Compare the claims with what the run actually exercised.

Keep first-pass screen-only observations uncontaminated by source or solutions.
For a tester that already knows a fixture, use a fresh context. Common tool
instructions may be supplied identically to all arms.

Use a verified broken case and its repaired counterpart to check detection and
false reports. Include an intentional behaviour that resembles a bug. Keep the
fault identity out of the tester's prompt. A known-working route checks control
competence; an agent failing it does not make the fixture broken.

Grade route completion, confirmed defects, false reports, reproduction success,
repair replay and evidence sufficiency separately. A high issue count is not a
success metric. Review mechanical assertions directly; reserve judgement about
enjoyment and human comprehension for people.

Reserve the continuation/recovery case from wording revisions. Test near-miss
requests so a scoped unit-test task does not launch a live playtest. Explicit
invocation comparisons do not measure automatic discovery reliability.

Run the writing-skills checker and catalogue preview before shipping. If repeated
runs show no benefit over short advice, remove ineffective instructions instead
of adding more procedure. Bundle a helper only when the same deterministic work
is repeatedly reinvented and its commands have been exercised live.
