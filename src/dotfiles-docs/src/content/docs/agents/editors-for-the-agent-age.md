---
title: Editors for the agent age
description: When agents write most of the code, "editing" becomes reading - why my most-used editor is a git TUI, where Fresh and Neovim fit, and the humble role of micro.
---

## The itch

Editor debates - vim versus IDE, mastery versus convenience - quietly
assume you're the one typing the code. When agents write most of it, that
assumption fails, and with it the whole calculus. My hands mostly produce
prose now: prompts, discussion, commit messages, documents like this one.
What my eyes need from tooling is something else entirely: read what the
agent changed, explore what exists, and occasionally make one small
surgical edit.

Optimising an editor for text-entry speed is optimising yesterday's
bottleneck.

## What I do

The numbers say it plainer than I could. In three weeks of
[keybinding data](/speed/two-keystroke-everything/), the "editor" I
opened 1,491 times is **lazygit** - a git TUI. Reading diffs, walking
commits, staging hunks: that's what editing a codebase mostly *is* now,
because the [review boundary lives at the commits](/agents/research-and-discuss/),
not at the keystrokes. A separate popup runs a critique pass over the
working diff when I want a second reader.

For exploring what exists, **Fresh** - a terminal IDE with a file tree,
mouse support and ordinary keybindings, summoned as a
[popup](/portable/tmux-is-the-workspace/) over whatever pane I'm in.
It's the right shape for a not-really-a-vim-person: when I open files to
*read* them, I don't want to spend attention on modal editing, I want to
spend it on the code.

**Neovim** stays for what it's genuinely best at - quick surgical edits
where vim grammar earns its keep - and **micro** (aliased to `m`) is the
humble baseline: a config tweak, one obvious change, zero ceremony,
works over ssh on every box. The honest count is that all of these
together get opened an order of magnitude less than lazygit.

So the "editor" is really a reading stack: lazygit for *what changed*,
Fresh for *what exists*, and an agent conversation for *what should
change next*. The writing tool of the agent age is mostly the prompt.

## Why it compounds

Matching tools to the actual job removes a tax I was paying on the old
job's tools. Editor mastery is a depreciating asset in an agent-heavy
workflow - a skill exercised less every month - while reading throughput
appreciates: the more agents produce, the more the bottleneck is how
cheaply I can review it. A one-keystroke diff reader lowers the cost of
looking, and things that are cheap to do get done more - more of the
agents' output actually gets read *because* reading it costs nothing.

And none of these tools own the workspace. They all arrive as popups over
the agents' panes and vanish - the workspace stays
[the session](/portable/tmux-is-the-workspace/), never a particular
editor's window arrangement. That's also why the
[IDE escape hatch](/speed/one-keybinding-to-escape/) is a menu entry
rather than a lifestyle: the GUI editor is one more tool that visits.

## Steal this

Make reading changes cost one keystroke - it's the highest-leverage
editor decision in an agent workflow:

```sh
# ~/.tmux.conf — lazygit over the current pane, in its directory
bind g display-popup -E -h 98% -w 98% -d "#{pane_current_path}" lazygit
```

Then next time an agent finishes something, `prefix + g` instead of
scrolling its transcript. Reviewing the diff, commit by commit, is a
better window into what actually happened than anything the agent says
about it.
