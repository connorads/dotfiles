---
title: Why work like this
description: Not the best way to work - a way I enjoy working, explained and justified.
---

This site explains the workflow encoded in [my dotfiles](https://github.com/connorads/dotfiles).
Not the mechanics - the repo's own README covers how the git-dir trick and the
nix rebuilds work - but the *why*. Why these tools, why these keybindings, why
it's worth the initial awkwardness.

One thing up front: I'm not proclaiming this to be the best way to work. It's
a way I enjoy working. If you take anything from these pages, it shouldn't be
my exact setup - it should be the habit of noticing friction and encoding the
fix somewhere permanent.

## The terminal, because it travels

I work in a terminal, in tmux. Not out of purism - out of portability. The
same workflow runs on my Mac mini, my MacBook Air, a Chromebook, a Raspberry
Pi, and inside any SSH session between them. tmux is the workspace; the
machine underneath is interchangeable. When everything you rely on is a shell,
a multiplexer, and a set of dotfiles, "setting up a new machine" is one
bootstrap script, and "working remotely" is indistinguishable from working
locally.

This is emphatically not an anti-IDE position. There's a keybinding to fling
the current directory into VS Code or Zed whenever that's the better tool.
The point isn't to never leave the terminal - it's that the terminal is home,
and home should be somewhere you've made comfortable.

## Speed compounds

Every individual piece of this setup looks like an over-optimisation.
[zoxide](/speed/navigate-without-thinking/) saves a second or two per
directory change. A [two-letter alias](/speed/two-keystroke-everything/)
saves a second per command. A tmux keybinding saves a popup's worth of
context-switching.

None of these matter alone, and each feels slightly unnatural for the first
week. But they stack. Dozens of times an hour, the thing you meant to do just
happens, with no perceptible gap between intent and effect. That's the real
payoff - not saved seconds, but staying in the flow you were in.

## Agents live here too

The terminal turned out to be the right place for AI agents, mostly by
accident. An agent is a long-running process that wants a pane: you can see
it working, interrupt it, and run several side by side. My tmux config treats
agents as first-class citizens - status-bar dots show
[which agents are ready](/agents/which-agent-is-ready/) for input, a popup
shows usage and remaining credits, and when a conversation genuinely forks,
[you can fork the session](/agents/fork-the-conversation/) into a new pane
and pursue both branches.

Tools like [herdr.dev](https://herdr.dev) are building polished versions of
exactly this idea, and I think they're great. I built mine into tmux instead,
because then it composes with everything else here - and because building it
customised to me is rather the point.

## Convenience needs guardrails

A workflow this automated - agents running commands, packages installing on
demand - needs a floor under it. Every package manager in these dotfiles has
a [supply-chain quarantine](/trust/supply-chain/); untrusted code runs in
[VM-isolated sandboxes](/trust/sandboxes/); remote machines get scoped,
revocable GitHub tokens. The rule of thumb: make the fast path safe, so you
never have to choose between the two.

## Steal the habit, not the config

Forking someone else's dotfiles wholesale rarely sticks - they're answers to
questions you haven't asked yet. What transfers is the loop: notice friction,
fix it once, encode the fix in version control, let it compound. Each page on
this site ends with a **steal this** section - the minimal version of the
idea you can adopt without any of my machinery around it.
