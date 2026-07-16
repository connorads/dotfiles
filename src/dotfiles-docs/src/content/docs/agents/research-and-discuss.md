---
title: Research and discuss
description: How a task actually starts - outcomes first, "research and discuss" to hold the agent in exploration, and plan mode entering late as validation and compression, if at all.
---

## The itch

There are two default ways to start an agent on a substantial task, and
both commit too early. Type the task and the agent starts editing files
within seconds - with your first framing of the problem, which is usually
your worst framing, baked into every change. Or start in plan mode and you
get a plan *before* the model has really absorbed the codebase, the
constraints, or what you actually meant - a confident-looking artefact
built at the moment of maximum ignorance.

The expensive part of agent work isn't the code. It's discovering, halfway
through an implementation, that you solved the wrong problem.

## What I do

I start a bare session (`cy`, my Claude alias) and open with outcomes, not
instructions: *"I want to be able to achieve X, Y and Z."* What, not how -
the how is what the next twenty minutes are for.

Then the load-bearing phrase: **"research and discuss."** It steers the
agent to read the codebase, look things up, and talk - without changing
anything. No plan mode, no permission gates; just a stated expectation,
and it's almost always respected. If the task touches something I have
opinions about, I load the relevant skill from my catalogue first, so the
discussion starts from positions I've already distilled - my testing
rules, my architecture defaults - instead of re-litigating them from
scratch.

What follows is a genuine two-way conversation: the agent surfaces what
the code actually does, I correct its framing, it challenges mine, options
get compared while they're still cheap words rather than expensive diffs.

Then the fork in the road. If the task turned out small and we've barely
burnt any context - *"go ahead"*, straight from the discussion. If it's
bigger, or the conversation has sprawled, *now* plan mode earns its place:
not as a permission gate but as **validation and compression**. The plan
forces everything we've converged on into one compact artefact - which
both checks the agent actually understood the discussion, and means the
implementation isn't dragging a long exploratory transcript towards the
context-window ceiling.

After that I mostly let it run. The quality mechanism is the front-loading
plus the checks - tests, hooks, review of the commits it lands - not me
watching it type.

## Why it compounds

Steering costs one sentence during discussion and a rework during
implementation. Moving the design conversation to *before* the first edit
is the cheapest quality intervention that exists - everything is still
reversible, because nothing has happened yet.

It also reframes what a plan is for. Plan-mode-first treats the plan as
bureaucracy to get through before the real work. Plan-mode-late treats it
as a checkpoint you *earn*: by the time it's written, it's a compression
of a real investigation, not a guess. Small tasks never pay the ceremony
at all.

And it composes with the rest of the setup. When a discussion genuinely
converges on two defensible designs, that's exactly when I
[fork the conversation](/agents/fork-the-conversation/) and build both.
The skills catalogue makes each discussion start further ahead; the
[readiness dots](/agents/which-agent-is-ready/) mean "mostly let it run"
doesn't mean "forget about it".

## Steal this

This one needs no tooling at all - it's a sentence. Start your next agent
task with:

> I want to achieve X, Y and Z. Don't change anything yet - research the
> codebase and discuss the options with me.

Talk until the approach stops moving. Then either say "go ahead", or - for
anything big - ask for the plan *now*, when there's finally something
worth planning.
