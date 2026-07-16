---
title: Fork the conversation
description: When a Claude or Codex session genuinely forks, prefix + Alt+b forks it - same history, two futures, side by side in tmux.
---

## The itch

Conversations with agents fork. You're deep into a session and there are now
two directions genuinely worth pursuing - two designs to compare, a refactor
and a bugfix that both build on everything discussed so far, an experiment
you want to try without derailing the main thread.

Inside a single session your options are all bad: pick one branch and lose
the other, or do the handoff-and-rewind dance - summarise the state, start a
fresh session, paste the summary, hope nothing was lost in translation. The
conversation's history is a tree; the tools present it as a line.

## What I do

In tmux, `prefix + Alt+b` branches the agent in the focused pane. The binding
resolves which agent is actually running there (Claude and Codex have
different fork mechanisms), finds its live session ID, and opens a menu:
fork into a split beside the original, into a new window, or - for parallel
experiments - several forks at once, each in its own git worktree.

Under the hood the Claude version is:

```sh
claude -r <session-id> --fork-session
```

Both panes now hold the *same conversation up to this point*, diverging from
here. Ask one to take the safe approach and the other the ambitious one.
Neither knows about the other; both remember everything that came before.

## Why it compounds

Forking removes the cost of curiosity. When trying the second idea costs one
keybinding instead of a ten-minute handoff ritual, you actually try it - and
comparing two real implementations beats debating two hypothetical ones every
time.

It also composes with the rest of the setup, which is the recurring theme of
these pages. Forks land in tmux panes, so the
[readiness dots](/agents/which-agent-is-ready/) track them like any other
agent; fork-into-worktree means parallel branches get parallel checkouts and
can't tread on each other's files. None of that needed building - panes and
worktrees were already first-class here.

## Steal this

You don't need my tmux machinery to fork a session. Claude Code supports it
natively:

```sh
claude --resume            # pick the session interactively
# or, with a known session ID:
claude -r <session-id> --fork-session
```

Run it in a second terminal and you have a fork. The tmux binding just
removes the friction: no finding session IDs, no arranging windows - one
chord, and the conversation splits in front of you.
