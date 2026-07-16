---
title: Terminal over IDE (and when it isn't)
description: The honest migration ledger - what I expected to give up going terminal-first, how agents quietly ate the IDE's side of it, and what's genuinely left.
---

## The itch

Every terminal-versus-IDE piece assumes a stable ledger. Terminal:
portability, composition, scriptability. IDE: step-through debugging,
rename-symbol refactors, rich merge tools, navigable megaprojects. Pick
your side, pay your costs. When I went terminal-first - for
[portability](/portable/same-shell-everywhere/), not purism - I expected
to be managing those trade-offs indefinitely.

The honest report from a few years in: the ledger didn't hold. Not
because the terminal grew the IDE's features, but because agents
absorbed them.

## What I do (and what happened to the trade-offs)

Go down the classic IDE-wins list and ask when I last actually needed
each one:

**Step-through debugging** - I haven't set a breakpoint in a long time.
When something needs debugging, the agent debugs it: reproduces,
instruments, bisects, reports back. The conversation replaced the watch
pane.

**Rename-symbol and cross-file refactors** - I don't do that by hand any
more at all. A refactor is a sentence now, not a keybinding, and the
agent's rename is checked by the same
[tests and hooks](/agents/research-and-discuss/) as any other change.

**Merge conflicts and rich diffs** - diff *reading* happens in
[lazygit and critique popups](/agents/editors-for-the-agent-age/);
gnarly conflict resolution I hand to an agent. The IDE's three-way merge
view was assistance for a manual task I stopped doing manually.

**Navigating code as a non-vim-person** - this one was real: before
Fresh I genuinely bounced off vim. A terminal IDE with a file tree,
mouse and non-modal keys closed the gap without sending me back to a GUI.

What's honestly left on the IDE side of my ledger is short: vendor-locked
ecosystems where the platform tool is simply the tool (Xcode-class -
though my last Android work ran agentically against an emulator, no
Android Studio opened); mouse support that's fine rather than fantastic;
and screen-sharing with someone for whom a tmux session is line noise.
The revealed preference of my
[escape menu](/speed/one-keybinding-to-escape/) says the same: the rare
escapes are mostly *Finder* - open the folder, crack a file out - not an
editor at all.

## Why it compounds

The pattern under all four entries is the same: the IDE's historic
advantages were mechanical assistance for *hand-editing code* - finding
it, renaming it, stepping through it. Agents didn't tilt the
terminal-versus-IDE ledger; they deleted its subject, by taking over the
hand-editing itself. What's left for my hands is
[reading and prose](/agents/editors-for-the-agent-age/), and the
terminal does those portably, composably, and
[identically on every machine](/portable/tmux-is-the-workspace/).

This stays a spectrum, not a side. If you step through native code
daily, or live in Xcode, your ledger looks different and the IDE end of
the spectrum is where you should stand. The claim isn't "terminal won" -
it's that my remaining IDE-wins list emptied out when I wasn't looking,
and I only noticed because I checked.

## Steal this

Not config this time - an audit. Write down your personal "the IDE does
this better" list. For each entry, two questions:

1. When did I last actually do this *by hand*?
2. Could an agent have done it that time?

Cross off everything without a recent date. Whatever survives is your
real reason to keep the IDE - so keep it, guilt-free, one
[cheap keybinding away](/speed/one-keybinding-to-escape/). Everything
crossed off is a trade-off you're no longer paying but may still be
planning your tooling around. The list was true when you wrote it; the
agents just got better since.
