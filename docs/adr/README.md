# Architecture Decision Records

Repo-level ADRs for these dotfiles: decisions with real trade-offs, where a future
reader would otherwise have to re-derive why the obvious alternative was not taken.

Subprojects keep their own ADR dirs (e.g. [`../../src/skl/docs/adr/`](../../src/skl/docs/adr/)).
This dir is for decisions that span the dotfiles themselves - shell glue, nix
modules, hooks, the test harness.

## When to write one

Write an ADR when you can name an option that lost **and** the specific thing that
killed it here - a mechanism, a measured number, a pinned version, a verbatim
error, an incident. A reason that would read the same in any repo is not a
decision: prefer a comment, then a subsystem `AGENTS.md`, then an ADR.

## Format

One required section, spelled `## Alternatives considered`, in which every option
carries the reason it lost. Everything else is free - `## Context`, `## Decision`,
`## Consequences`, a known limit, a parked list - used where each earns its place.
Length is not the measure: a short record that names the losers beats a long one
that does not.

File name: `NNNN-slug.md`, keeping the digit width already in use. Numbers are
never reused, so the next one is the highest on disk **and** in
`git log --all --diff-filter=A --name-only`. No Status field - a record on disk is
in force, and a decision not yet made is a draft rather than a file.

Write timelessly, in the present tense. Change history ("we used to...", "this
replaced...") belongs in commit messages. A reversed decision earns a new record
plus one blockquote line under the old record's H1; the old body stays as written.

Records already here and in the subprojects stand as they are; this format governs
new ones.

The `adr` skill (`skl adr`) carries the rest - the trigger test, what not to write
a record for, supersession, and the read-before-you-change path - and is the source
of truth for the mechanics. This file states only what is local to these dotfiles.
