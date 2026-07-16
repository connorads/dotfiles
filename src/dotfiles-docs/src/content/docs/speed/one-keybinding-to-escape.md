---
title: One keybinding to escape
description: Terminal-first is not terminal-only - prefix + O flings the current directory into Zed, VS Code, or Finder, and the exit being cheap is why staying feels free.
---

## The itch

Terminal-first sounds like a commitment, and commitments invite a nagging
question: what happens when a task genuinely wants a GUI? If the answer
is expensive - find the project path, launch the app, navigate to the
folder, lose your place - you end up in one of two bad states. Either you
stay in the terminal grudgingly, forcing tasks through the wrong tool to
protect an identity, or you leave for the IDE and don't come back,
because the trip cost enough that you set up camp there.

Both are sunk-cost reasoning. The fix isn't more commitment; it's making
the exit cost nothing.

## What I do

`prefix + O` opens a little menu over the current pane: **Zed**, **VS
Code**, or **Finder**, each launched on the pane's working directory. One
chord and the project I'm standing in is open in a GUI, no path-finding,
no context reconstruction. The terminal session stays exactly where it
was for when I'm back.

The door swings the other way too, and that direction gets far more use:
GUI-shaped tools come *into* the terminal as
[popups](/portable/tmux-is-the-workspace/) - lazygit on `prefix + g`, a
terminal IDE on `f`, Neovim on `v` - appearing over the work and
vanishing, rather than me travelling to them.

How often do I actually take the exit? Three weeks of
[keybinding usage data](/speed/two-keystroke-everything/) says: five
times. That's not a failed feature - that's the feature. Like the
[sandboxes](/trust/sandboxes/), it's insurance: the value of a cheap exit
is not how often you use it but what its existence does to every moment
you don't.

## Why it compounds

A cheap exit ends the internal debate. Without it, "should I be doing
this in an IDE?" is a recurring background negotiation, and each round of
it costs more than the keybinding ever will. With it, the question
answers itself per-task in half a second: if the task wants an IDE, `O`,
done; if not, that thought is finished.

It also keeps the terminal honest. Staying terminal-first because leaving
is painful would be lock-in; staying when leaving costs one chord means
the terminal is winning on merit, task after task. The
[manifesto](/why/) calls the terminal home, not a cage - this binding is
what makes that sentence true rather than aspirational.

## Steal this

One binding in `~/.tmux.conf`, using apps you already have:

```sh
bind O display-menu -T " Open cwd in… " -x C -y C \
  "VS Code" c "run-shell 'code \"#{pane_current_path}\"'" \
  "Zed"     z "run-shell 'zed \"#{pane_current_path}\"'"
```

`prefix + O`, then one letter, and you're in your GUI editor at the right
directory. You'll use it less than you expect - and staying in the
terminal will feel lighter from the day you add it.
