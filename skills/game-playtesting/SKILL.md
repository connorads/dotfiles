---
name: game-playtesting
description: >-
  Plays running games to verify connected progression, investigate control,
  camera and collision jank, and confirm repairs. Use when asked to playtest a
  build, check whether a game can be completed, reproduce a gameplay defect,
  or test a fix through actual play. The workflow targets browser execution;
  other engines need equivalent control and observation tools. Not for judging
  enjoyment, inventing game mechanics, visual target matching, or a specified
  unit-test change that needs no live-game investigation.
---

# Game Playtesting

**Which player journey did you actually verify, under which conditions?**

## Establish the evidence

Record the build, starting state, player goal and observable completion condition.
Match the journey to the request: a camera repair needs its affected transition,
while a completion check needs the route to the ending. If the request only
needs a specified unit regression, use testing without launching this workflow.
Use an isolated test profile so resets preserve the user's saves. Keep requested
sound and accessibility settings throughout testing. A muted session cannot
establish audible feedback quality.

Use the project's existing browser or game-control tools. Read
[Control and observation](references/control.md) before live play. Calibrate the
controls in the rendered game before interpreting failed actions as defects.
A tool returning successfully establishes that the tool ran, not that the game
accepted the input or communicated its result.

For open-ended playtesting, begin with player-visible screens, text and controls.
Preserve that first pass before consulting source, hidden state or a walkthrough.
A source-informed agent cannot become an uninformed player by promising to ignore
what it read. When an uninformed pass is requested and this context knows the
solution, use a fresh tester with only the public brief and tool instructions.
For a known defect or repair replay, record existing knowledge and reproduce the
trigger directly. Do not repeat discovery work that the request does not need.

Record control, information and timing separately:

| Dimension | Distinguish |
| --- | --- |
| Control | Ordinary input; direct actions or mutation hooks |
| Information | Player-visible evidence; source/route/state guidance |
| Timing | Normal clock; pause-assisted; stepped or accelerated |

State-guided movement through real controls can establish traversal. Teleporting
to an objective establishes neither the connecting route nor its prerequisites.
Pause-assisted success does not establish normal-clock execution. Label narrower
evidence positively instead of discarding useful diagnostic work.

## Play a connected journey

Read [Journeys and investigation](references/journeys.md). Follow the objective
through its prerequisites and transitions. Record reached milestones and the
route between them. Inspect the rendered results throughout; a sequence of
internal flags is insufficient.

Choose targeted exploratory checks around the observed risks. Progression,
wall contact and interrupted input require different actions; random wandering
is not a substitute for each. Keep the test's question distinct from the
player's objective and the comparison's time budget distinct from game pacing.

## Investigate and repair

For a suspected defect, retain the first observation and state the expected
behaviour and its basis. Compare plausible causes: rejected input, wrong state,
intended recovery, collision, hidden feedback or controller limitations. Inspect
code and telemetry when they can distinguish those explanations.

Reproduce the violation before changing the game. A stalled agent alone does
not prove a blocked route. If the same attempt provides no new evidence, change
the control method or investigate the disputed mechanism instead of repeating
it or weakening the challenge.

Carry authorised repairs through the relevant regression check and a visible
replay of the trigger, then continue through the affected transition. Existing
testing and engineering skills own implementation. Game-design owns proposed
changes to rules, difficulty and intended experience. Keep unrelated tuning
stable when testing a causal explanation.

## Close with reviewable results

Read [Evidence and reporting](references/evidence.md). Report completed routes,
confirmed defects, unresolved observations and untested content separately.
A successful prepared-state rehearsal cannot close an untested journey.
Preserve playable builds, launch instructions, controls and evidence for the
user. Close disposable browser sessions by name.

The [source notes](references/sources.md) explain scope and limits.
`evals/README.md` and `evals/evals.json` maintain this skill; they are not an
instruction to run a skill benchmark during ordinary playtesting.
