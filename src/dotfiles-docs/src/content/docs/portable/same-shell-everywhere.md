---
title: Same shell everywhere
description: One flake, six machines - nix, home-manager, and mise make every box the same box, and a new machine one bootstrap script away.
---

## The itch

Machines drift. Each one accumulates its own aliases, its own slightly
different tool versions, its own "oh right, *this* box doesn't have
that" - until every remote host is a downgrade and every new laptop is a
lost day of setup. Muscle memory is an investment, and drift is the tax:
a shortcut that only exists on one machine isn't a habit, it's a local
quirk.

Agents inherit the drift too. A shell function that exists on the laptop
but not the Pi breaks the same workflow for them as for me - and I want to
[move agents onto remote machines](/portable/tmux-is-the-workspace/)
casually, which only works if nothing over there is different.

## What I do

**One Nix flake, six targets.** Two Macs (the MacBook Air workstation and
the headless Mac mini dev server) via nix-darwin, and home-manager for the
Linux fleet: a Chromebook container, a cloud dev box, a Raspberry Pi, and
GitHub Codespaces. They share the same modules with *additive* package
tiers - a core that goes everywhere, server extras that make a headless
box feel like home, workstation extras for the machine with a screen. The
Pi isn't a lesser environment; it's a smaller tier of the same one.

**Dev tools through mise, pinned by lockfile.** Language runtimes and
fast-moving CLIs come from mise, and the committed lockfile pins exact
versions *and* checksums for all three platforms I run - so every machine
installs the identical vetted artifact instead of re-resolving versions
for itself. (The [supply-chain quarantine](/trust/supply-chain/) gates
what's allowed into that lockfile in the first place.)

**The dotfiles are just files in `$HOME`.** No symlink farm, no dotfile
framework: `$HOME` is the work-tree of a git repo whose metadata lives out
of the way in `~/git/dotfiles`. The mechanics are the
[repo README's](https://github.com/connorads/dotfiles) job; the point here
is that every function, alias, keybinding - and every agent rule, since
`AGENTS.md` and the hooks are tracked files too - travels as one commit
history.

**Convergence is one command.** A brand-new machine is
`curl … install.sh | bash`. An existing one is `up` - bump the lockfiles,
commit them, rebuild - or `up --frozen` to converge a drifted box onto
exactly the committed locks, no bumps. Drift isn't prevented by
discipline; it's erased by rebuild.

The result is the thing the [workspace page](/portable/tmux-is-the-workspace/)
takes for granted: ssh to any of them and the prompt, the functions, the
completions, even the agents' behaviour are indistinguishable from local.

## Why it compounds

Every other page on this site pays out per machine, and this layer is the
multiplier. A [two-keystroke alias](/speed/two-keystroke-everything/) is
only muscle memory if it works on all six boxes; a papercut fixed in a
tracked function is fixed six times; a new tmux binding exists everywhere
before I've finished the commit message.

It also makes customisation *fearless*, which is the quieter payoff.
Config-as-code with rollback means a bad idea costs one revert, so the
threshold for encoding a fix permanently drops to nearly zero - and
encoding fixes permanently is the whole habit this site is about.

## Steal this

You don't need Nix to kill the drift - start with the git trick alone.
Your dotfiles, tracked in place, no symlinks:

```sh
git init --bare ~/.dotfiles
alias dot='git --git-dir=$HOME/.dotfiles --work-tree=$HOME'
dot config status.showUntrackedFiles no
dot add ~/.zshrc && dot commit -m 'track zshrc'
```

On the next machine, clone it and check out into `$HOME`. Every `dot
commit` from then on is a fix that follows you. Declarative packages,
lockfiles, and one-command rebuilds can come later - a git history of your
`$HOME` is most of the value, available today.
