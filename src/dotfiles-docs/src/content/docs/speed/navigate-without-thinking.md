---
title: Navigate without thinking
description: zoxide replaces cd with a frecency index of everywhere you go - and it's the clearest example of how this whole setup pays for itself.
---

## The itch

You know where you're going. You always know where you're going. And yet
`cd`, tab-completion, and your memory of the exact path stand between you and
a directory you visit thirty times a day. Watching yourself type
`cd ~/git/some/nested/project` for the hundredth time is watching a human do
a lookup a computer should be doing.

## What I do

[zoxide](https://github.com/ajeetdsouza/zoxide) is one line in my `.zshrc`:

```sh
eval "$(zoxide init zsh)"
```

From then on, `z` learns every directory I visit and ranks them by
*frecency* - a blend of how often and how recently. `z kb` takes me to
`~/git/kb` from anywhere. `z dot` finds the dotfiles docs project. A couple
of characters is almost always enough, because the ranking means the match
you want is the match you get. When it's ambiguous, `zi` opens an interactive
picker.

There is no setup beyond that line, no bookmarks to maintain, no index to
rebuild. It learns by watching.

## Why it compounds

zoxide is the cleanest example of the thesis of this whole section. In
isolation it's absurd: a tool to save two seconds on `cd`. Nobody needs that.

But directory changes happen dozens of times an hour, and each one used to be
a small interruption - recall the path, type it, correct it. With zoxide the
navigation happens at the speed of intent, and after a week you stop being
able to feel it at all. That's the pattern everything else here follows:
individually unjustifiable, collectively transformative. Once one lookup
disappears, you start noticing every other place you're doing the computer's
job for it.

It also feeds the portability argument: `z` works identically on every
machine I own, because it's installed and initialised from the same dotfiles
everywhere.

## Steal this

Install zoxide (`brew install zoxide`, or your package manager of choice) and
add the init line to your shell config:

```sh
eval "$(zoxide init zsh)"   # or: zoxide init bash / fish / ...
```

Then give it a week. The first few days it knows nothing and feels pointless -
keep using `z` where you'd use `cd` and let the index build. The moment it
clicks is when you type two letters for a deeply nested path and land there
without thinking about it.
