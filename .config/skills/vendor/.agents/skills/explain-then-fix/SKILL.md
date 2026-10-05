---
name: explain-then-fix
description: Work through bugs or reported issues one cause at a time — reproduce the reporter's own case, explain the root cause with annotated evidence and a diagram, lay out fix options, wait for "go", then fix and show before/after.
disable-model-invocation: true
---

# Explain, Then Fix

The user decides every fix. Nothing is changed, pushed, closed or published
until they say so, and everything happens in this chat.

## Steps

1. **Pick.** One problem, or a few that look like one cause. Say which, in one
   line.

2. **Reproduce.** On the reporter's own case: their data, their environment,
   their steps. Use the project's own repro and screenshot tooling (its
   AGENTS.md or CLAUDE.md, and its skills). Measure it: a number, a count, the
   exact message. If their case can't be had, say so and ask for it; a
   stand-in is labelled as a stand-in.

3. **Explain.** In plain words, naming things the way the reporter would,
   never internal ids.
   - **The evidence with the cause drawn over it**, whenever there is a
     screenshot, output or trace that shows the problem: the measured values
     marked on it, from what the program computed, not eyeballed.
   - **A diagram of the cause**, in chat: what the code believes, and what
     the user sees because of it.
   - The code locations (`file:line`) in text, under the pictures.

4. **Discuss.** Lay out the fix options, each with what it fixes, what it
   doesn't, and what else it touches. Give a recommendation. Then stop and
   wait for "go".

5. **Fix, on "go".** Implement it. Add the few tests that fail before and
   pass after, on the reporter's case where there is one. Show before/after
   of the reported case, and look at it yourself before sending it.

6. **Next.** Say what is left of the group, then propose the next group and
   go back to 1.

## Rules

- No code change before "go".
- No push, issue close or page publish without an explicit yes, every time.
- A page published earlier is read-only reference.
- Show the reported case, not a synthetic one; a stand-in can hide the bug.
