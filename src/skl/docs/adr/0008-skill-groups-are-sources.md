# Skill groups are sources; `install` copies vetted local bytes

## Context

Two gaps in `skl`:

1. **The flat list spams.** 80+ skills in one undifferentiated list. Related skills
   (elevenlabs, expo) should read as searchable *groups*, not loose entries. There was
   also a bad ref: five elevenlabs skills sat in `vendor` as if unrelated.
2. **No way to persist skills into a project.** `skl load` is session-only (ephemeral).
   There was no "make these skills stick in this repo" action.

An earlier handoff designed `install` as a **re-fetch from upstream**, needing a whole
`provenance.ts` + `upstream` config layer. A verified capability of the `skills` CLI made
that obsolete: `skills add <LOCAL-PATH> --skill <names>` treats a local directory as a
first-class `sourceType: "local"` source (`skills` v1.5.19) — a near-byte-fidelity copy
into `.agents/skills/`, the `.claude/skills/` symlink fan-out, and a `skills-lock.json`
entry, all locally, no fetch.

## Decision

**A group of skills is a source** (skl's existing word). Realised as a per-set `skills`-CLI
project dir at `~/.config/skills/sets/<name>/` (its own `.agents/skills/` + `skills-lock.json`),
registered as one more `paths` entry in skl's `config.json`. Grouping needs **no new data
model**: rows are already `source/name`, the picker is already `--scheme=path`, so typing
`expo` filters to the group. A **whole-source ref** is a trailing slash: `expo/` = every
member of source `expo`. Backward-compatible — `parseRef` reads an empty name after the
first slash as the group ref, which no valid concrete ref produces.

**`skl install` copies local vetted bytes, never re-fetches.** It delegates to
`skills add <source-root-abs-path> --skill <names> -y [-g]` run in the project dir. The
catalogue is the local source, so the copy is frozen at the vetted bytes at the point of
use. This is the same delegation relationship skl already has with `skills` (fetch) and
fzf (picker).

Mental model: **load** puts a skill in this session; **install** puts it in a project; a
group of skills is a source.

## Considered Options

- **The manifest `pkg:` model** (a second file naming grouped skills) — rejected: a second
  invisible source of truth beside the config + the sets' own lockfiles.
- **The handoff's re-fetch-from-upstream install** (`skills add <owner/repo>` at install
  time) — rejected: puts *unvetted* bytes at the point of use (bypassing the vetted+pinned
  catalogue) and needs a whole `provenance.ts` + `upstream` config layer. Deleted both.
- **skl reproducing the `.agents`/`.claude` fan-out itself** — rejected: fragile, reinvents
  a `skills` mechanism skl delegates to by design.

## Consequences

- The catalogue stays vetted + pinned; `install` is a **frozen local copy**. A frozen
  install *should not* auto-update — the skill bytes are committed in the project's
  `.agents/skills/`.
- The project lock records `sourceType: "local"` + an **absolute** path, so it is **not
  portable to another machine** (accepted — the bytes are committed, and the whole point is
  a frozen copy, not an auto-updating pin).
- Set → project drift is **additive-only**: `install` adds/overwrites, never removes a
  project member that was later dropped from a set. A `--sync` verb could close that gap;
  not built until it bites.
- Loading a whole group (`skl load expo/`) needed no `cli.ts` change — `loadRefs` already
  batch-resolves and batch-injects; `resolveRefs` just expands a source ref in place.

### Parked (not building yet)

- `--sync` (remove project members dropped from a set).
- `skl adopt`/`get` — a verb for pulling a *new* group into the catalogue (today the
  curation moves are manual `skills add`). Its value is the bookkeeping (set dir + config
  line + gitignore), not the fetch; build when the manual dance annoys. **Not** named `add`
  (collides with `skills add`).
- Nested display within a source; remote-only groups; portable-lock post-processing.
