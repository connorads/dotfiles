# Context

Working glossary and domain notes for `critique`. Terms here are meaningful to
the tool's domain, not implementation trivia.

## `critique` - headless review by another agent

An agent cannot review its own work adversarially. Grading it in-context, in a
subagent or in a fork is the same model reasoning from the same transcript, so
it rationalises the same mistakes. `critique` hands the change to a fresh
process, by default the *other* agent (Claude reviews Codex's work and the
reverse), runs it read-only, and returns one JSON document a caller can branch
on without parsing prose.

## Target

The unit under review: the uncommitted working tree, a branch against its base,
one commit, a GitHub PR, or a plan (prose, not code). `auto` resolves to the
working tree when it is dirty and to the branch otherwise.

## Reviewer

One headless agent process (`codex` or `claude`) with a pinned model and
effort. Always read-only, enforced by the reviewer's own sandbox rather than by
the prompt asking nicely.

## Panel

More than one reviewer on the same target, run in parallel. Their findings are
merged: overlapping findings on the same lines become one, tagged with every
reviewer that raised it. A panel still reports when some reviewers fail; only
all failing is a failed review.

## Finding

One problem the reviewer asserts, with severity, location (nullable - a plan
has no lines), confidence 0-1 and a recommendation. A finding is a claim, not a
fact: the caller triages it against the code.

## Verdict

`approve` or `needs-attention`. The exit code carries it, so a loop can branch
on `critique`'s status alone.

## Context delivery

How the change reaches the reviewer. **Inline**: the diff is pasted into the
prompt, for small changes. **Self-collect**: the prompt names the read-only git
commands and the reviewer runs them, for large ones.

## Repo guidance

`AGENTS.md`, `CLAUDE.md` and `REVIEW.md` from the repo root, included in the
prompt. For a PR they are read from the **base** ref, so a PR cannot rewrite
the rubric it is judged by.

## Rubric

An optional `skl` skill whose full bundle (`skl inline <ref>`) is pasted into
the prompt as extra review criteria.
