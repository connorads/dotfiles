---
title: tmux is the workspace
description: Sessions that survive disconnects and reboots (agents included), tools as popups, and a status bar that knows about agents - the layer that makes every machine the same machine.
---

## The itch

The workspace used to be the machine. Your window arrangement, your running
processes, your half-finished everything - all state that lives and dies
with one computer, evaporates on disconnect, and has to be rebuilt by hand
somewhere else.

Agents make this acute. An agent mid-task is a long-running process you
can't afford to lose, and the machine best placed to host it is usually
*not* the laptop - laptops close, move between networks, and get left at
home. If the workspace is the machine, every agent is hostage to whichever
machine you happened to start it on.

## What I do

**The session is the workspace.** `tma` attaches to (or creates) a session
called `main` - locally, or over ssh/mosh to the Mac mini or a cloud dev
box. The mini is where most long-running agents actually live: I line them
up, close the laptop, leave the house, and reattach from wherever I am to
find the [readiness dots](/agents/which-agent-is-ready/) waiting. Closing
the laptop means *detaching*, not stopping. The active tab even turns red
when a pane is an ssh hop, so I always know which machine a keystroke
lands on - and `F10` suspends the outer tmux so an inner remote one gets
my prefix keys.

**Tools are popups, not layout.** The panes hold the actual work - agents,
mostly - and everything else appears *over* them and vanishes: lazygit on
`prefix + g`, an editor on `f`, the skill loader on `Alt+s`,
combined AI usage on `a`, a system monitor on `b`. Nothing claims a
permanent pane, so the workspace stays legible at a glance. And because
nobody remembers thirty bindings, `prefix + /` is a command palette - fzf
over every binding's description, Enter replays the key - and `prefix + ?`
is the cheatsheet.

**The status bar is the instrument panel.** A patched tmux splits it into
two rows - window tabs at the top of the terminal, system chrome at the
bottom - and the chrome is responsive to client width, from everything
(git, host, AI usage windows, memory, clock) down to just a clock on a
phone-sized mosh session. Window tabs show the project (cwd basename), an
unseen-output `+`, and the agent state dot. One glance answers: who's
working, who's blocked, what's this machine's headroom.

**The workspace survives reboots - agents included.** Layout autosaves
every five minutes (restore stays deliberately manual). The interesting
part is what comes back: custom resurrect strategies restore Claude, Codex
and OpenCode panes by rebuilding each pane's *exact* command - resume
flags, permission mode, model - from its saved argv and a session-ID map
written at save time. After a reboot the agents reattach to their own
conversations, not to blank prompts.

**Owning the layer means patching the layer.** The dimming of inactive
panes and the split status bar aren't tmux features - they're small
patches applied to the tmux build in my Nix config. That's the quiet
payoff of making one layer the workspace: when it has a papercut, you can
fix the layer itself, once, for every machine.

## Why it compounds

Everything else on this site lands in a tmux primitive, which is why this
page is load-bearing. [Forked conversations](/agents/fork-the-conversation/)
are panes; [readiness](/agents/which-agent-is-ready/) is window-tab
decoration; skills, usage meters and git are popups; remote machines are
just sessions I haven't attached to right now. Each new tool inherits
persistence, portability and the instrument panel for free, because those
belong to the workspace layer, not to the tool.

And it changes the relationship with hardware. The machine underneath is
interchangeable - Air, mini, Pi, a cloud box - because
[the shell is the same everywhere](/portable/same-shell-everywhere/) and
the workspace is a session, not a screen arrangement. "Setting up my
machine" collapses into "attaching".

## Steal this

The core needs no plugins, no patches, and one alias:

```sh
alias tma='tmux new -A -s main'
```

`new -A` attaches if the session exists, creates it if not - the same
muscle memory lands you in your workspace whether it's your first attach
of the day or your fifth. Put it on a server and the workspace becomes
somewhere your laptop merely *visits*:

```sh
ssh -t yourbox 'tmux new -A -s main'
```

Start your next long-running agent inside that. Disconnect, reconnect from
anywhere, and it never noticed you left - which, once you trust it, is the
whole point.
