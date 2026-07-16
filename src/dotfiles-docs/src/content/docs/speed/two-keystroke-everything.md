---
title: Two-keystroke everything
description: The commands you run most should cost the least - c and cy into Claude, ~200 git aliases, functions on the PATH, and usage data deciding what earns a key.
---

## The itch

Your shell prices every command the same: however often you run it, you
pay full length every time. That's the wrong pricing model. Cost should
follow frequency - the things you do constantly should cost almost
nothing, and the tax you pay on a common command is frequency times
friction, compounding forever.

My own numbers make the case bluntly: in three and a half months of shell
history on this machine, my most-typed command - 860 times, roughly one
keystroke-sequence in four - is launching a Claude session. If that costs
a long flag-laden invocation instead of two letters, I pay the difference
hundreds of times a month.

## What I do

**Alias the top of the distribution.** `c` launches Claude with my house
rules appended; `cy` is the same with permission prompts off (sane only
because of the [supply-chain floor](/trust/supply-chain/) under it). Git
comes as ~200 two-to-four-letter aliases from oh-my-zsh's git plugin -
`gst`, `gco`, `gl` - which has a bonus over inventing your own: it's a
shared vocabulary, already documented, already in other people's muscle
memory.

**Functions go on the PATH, not just the shell.** My ~120 custom
functions are dual-mode: zsh autoloads for me, plain executables in
`~/.local/bin` for everything else - which in an agent-heavy setup
matters, because agents run `bash` subprocesses. A shortcut only I can
use from an interactive prompt is half a shortcut; `ts status` or
`killport 3000` work for the agents too.

**In tmux, everything common is prefix-plus-one-key** - and the keys
follow conventions so they stay guessable: a capital is its lowercase
key's sibling (`g` lazygit, `G` lazygit-for-dotfiles), Alt is the pocket
for standalone tools. For everything rarer there's a searchable palette
(`prefix + /`) and a Tools launcher, because thirty bindings exceed
anyone's memory.

**Usage data decides what earns a key.** Every tmux binding passes
through a tracking wrapper that logs each press, and typed commands land
in atuin - so "do I actually use this?" has an answer. Three weeks of
data: the lazygit popup opened 1,489 times, pane zoom 1,005, the skill
loader 331 (fifteen times a day - a number I'd have guessed wrong in
both directions before measuring). And the occasional utilities that
measured roughly zero lost their keys: they moved into the Tools
launcher, one searchable menu instead of ten forgettable chords.

That last part is the real answer to "how do you tell a shortcut that
will stick from one you'll forget?" You don't tell. You measure, then
demote.

## Why it compounds

Each alias saves a second, which is absurd to optimise - the
[zoxide page](/speed/navigate-without-thinking/) already made that
argument, and it applies squarely here. But cheap commands don't just
save time; they change behaviour. When starting an agent session costs
two letters, you start more of them - a second opinion here, a
[research-and-discuss](/agents/research-and-discuss/) session there -
where a costly launch would have meant not bothering. The shortcut isn't
shaving the task; it's lowering the threshold at which the task happens
at all.

And because the aliases, functions and bindings are
[tracked dotfiles](/portable/same-shell-everywhere/), the muscle memory
works on every machine at once - a shortcut that only exists on one box
would be a quirk, not a habit.

## Steal this

Don't steal my aliases - steal the pricing rule, and let your own history
choose the targets:

```sh
history 1 | awk '{print $2}' | sort | uniq -c | sort -rn | head -20
# (zsh; in bash, plain `history` already lists everything)
```

Anything in that top twenty deserves two or three keystrokes. Start with
the obvious two:

```sh
alias c='claude'
plugins+=(git)  # oh-my-zsh, before it loads: ~200 shared git aliases
```

Then re-run the count in a month and demote what you stopped using. The
habit worth keeping isn't any particular shortcut - it's pricing your
commands by how often you run them, and checking the receipts.
