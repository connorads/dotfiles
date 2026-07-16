---
title: Which agent is ready?
description: Window-tab dots for per-pane agent state, an attention-ranked jump popup, usage meters, and an opt-in auto-continue watcher - supervising several agents without polling them.
---

## The itch

Running one agent, you watch it. Running several, watching *is* the job.
As I write this my tmux session has six windows and twelve panes, most of
them holding an agent, and at any moment each one is in one of three states:
mid-turn and needing nothing, blocked on a question and needing ten seconds
of me *right now*, or finished and needing its work read.

From the window list all three look identical. So you poll - round-robin
through the panes asking "does anyone need me?" - and polling fails in both
directions. Check too often and you never get your own thinking done; too
rarely and an agent sits blocked on a yes/no for twenty minutes while its
context goes cold. The scheduler is you, and you're bad at it.

## What I do

**Dots on the window tabs.** Every agent lifecycle event - prompt
submitted, tool call, needs permission, turn finished - fires a hook
(Claude's `settings.json`, Codex's equivalent) into a small script that
records a state per pane. Each window tab shows one dot for the worst state
across its panes:

| Dot | State | Meaning |
| --- | --- | --- |
| `◆` red | blocked | needs you (permission or input) - also rings the bell |
| `◐` peach | working | agent mid-turn |
| `●` blue | done | finished, unseen |
| `○` green | idle | seen, at rest |

Shape encodes state as well as colour, so the legend survives a colour
clash and colour-blindness. The bell rings only for *blocked* - the one
state where minutes of latency are pure waste.

The semantics are an email inbox. *Done* stays blue until I actually look
at it: focusing the window marks it read and the dot ages to idle. If I was
already watching the pane when the agent finished, it skips straight to
idle - no unread badge for something I saw happen. There's even
mark-as-unread (`prefix + Alt+.`) for "I looked, but future-me still needs
to deal with this". Detached sessions never auto-age - a blue dot on the
Mac mini stays blue until somebody is genuinely looking. And a background
sweep catches agents that die without a clean signal, so a stale dot can't
lie for more than ten seconds.

**Jump by attention.** `prefix + A` opens a popup listing every agent pane
across every session, ranked blocked first, then unread, then working, with
a live tail of each pane as the preview. Enter jumps there. When the dots
say someone needs me, this is how I arrive without remembering where they
live.

**Meters before starting more.** `prefix + a` is the sibling binding: a
combined usage dashboard for Claude, Codex and Cosine, with the compact
version always in the status bar. Before kicking off another long task I
can see which subscription window has headroom - which is often what
decides whether the task goes to Claude or Codex at all.

**Auto-continue, per pane, opt-in.** When Claude hits its rolling usage
limit it doesn't exit - it blocks, prints the reset time, and waits for a
human. For an overnight task that's the whole night lost. `claude-watch`
arms a *specific* pane: it spots the limit banner, parses the printed reset
time, waits it out, types "continue", and verifies the message landed.
Caps and a wait ceiling make it give up noisily rather than babysit a
week-long limit. Nothing runs unless I arm the pane.

## Why it compounds

The scarce resource in an agent workflow isn't compute, it's my attention.
The dots turn polling into push: silence means nobody needs me, a bell
means someone does, and blue means there's reading to do whenever I next
surface. Both failure modes of polling disappear - I stop interrupting my
own work to check, and agents stop waiting long for answers.

It also composes, which is the recurring theme of these pages. A
[forked conversation](/agents/fork-the-conversation/) lands in a pane, so
it gets a dot like everything else. Sessions on remote machines carry the
same dots because the hooks travel with the dotfiles.

And the honest part: the endgame isn't maximal utilisation. I used to
supervise agents from my phone with [remobi](https://remobi.app/); these
days I mostly don't. I'd rather line the agents up before leaving the
house, go live my life, and read the blue dots when I'm back. A readiness
system you trust doesn't just make watching cheaper - it makes *not
watching* safe.

## Steal this

You don't need my hook machinery for the core of it. Two hooks in
`~/.claude/settings.json` give you unread-message semantics on stock tmux:

```jsonc
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command",
      "command": "tmux set -w window-status-style 'bg=blue,fg=black' || true" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command",
      "command": "tmux set -w -u window-status-style || true" }] }]
  }
}
```

When Claude finishes a turn, its window tab turns blue; your next prompt
clears it. Add a `Notification` hook with a red style for "needs
permission" and you have the two states that matter. That's most of the
value: being told, instead of asking.
