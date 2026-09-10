# Control and observation

## Calibrate the actual controller

Confirm the intended build and an actionable screen. Observe a tap, a timed
hold, release, camera motion and pause/resume. Check focus and coordinate
mapping. A screenshot location and a world-space position are different
representations; do not send one as the other.

Use normal browser keyboard and mouse operations rather than direct game action
functions. Put bounded input sequences in a local tool call, release held input
in cleanup, and inspect the resulting frame. Leaving a key down across model
reasoning makes its duration depend on tool latency. Text insertion does not
exercise keyboard listeners.

For a 3D game, distinguish absolute pointer position, relative pointer-lock
motion and drag-to-look. Check which mode is active after menus or focus changes.
Use the supported alternative when a tool cannot supply a control mode, and
record what was not exercised. Do not change the game to accommodate an
unverified controller assumption.

## Keep time honest

Record action duration, observation time and whether the game continued while
the model reasoned. Inspect both simulation elapsed time and wall time when
available. They need not advance equally.

When traversal or capture is implausibly slow, inspect the actual browser launch
and rendering backend before judging game pacing. A headless software renderer
can invalidate timing despite a requested headed mode. Preserve the failed
attempt, correct the environment, and restart any affected comparison budget.

Use shorter action bursts near hazards and transitions. For a normal-clock
claim, let the game run normally and retain evidence of the relevant interval.
If reasoning latency prevents useful control, a supported pause can enable a
narrower diagnostic run. Reset held input when pausing or resuming. Preserve
that assistance in the report, including automatic pauses caused by focus loss.

Frame stepping and acceleration answer specific questions. Verify suspected
timing or physics defects again under intended runtime conditions because the
altered clock can create them. A browser trace is useful evidence, not a promise
of deterministic game replay.

## Observe enough to make the claim

Inspect images, not just their filenames. A static frame can show obstruction
or clipping but cannot establish response latency or motion continuity. For a
transient issue, retain surrounding frames or a video interval and synchronised
input/state events where available. State when the sampling interval cannot
resolve the disputed event.

For short effects, start read-only input/state sampling before issuing the
browser action. A click call can return after an attack's recovery ends, making
a later movement measurement miss the action entirely. Record observed event
times and simulation progress; requested wait durations are not measurements.

Use the existing browser and recording skills for commands and capture details.
Check installed command help before relying on a flag. Avoid a new automation
framework when existing input and capture tools suffice.
