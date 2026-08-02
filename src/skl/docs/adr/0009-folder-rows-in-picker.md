# Folder rows in the picker; ref-scoped search

## Context

The `prefix + Alt+s` picker (ADR-0004) showed all ~170 skills as one flat fuzzy
list. Group actions (load/install a whole `source/`) existed in the core (ADR-0008)
but were reachable only through bespoke keybindings, which felt haphazard, and each
row's full description made the list hard to scan.

## Decision

**A group is a first-class row.** `skl list --folders` leads each source block with
a folder row `source/  (count)`, then that source's skills. One gesture, `enter`,
does the object-appropriate thing:

- folder row `elevenlabs/  (5)` → loads the whole group (the row's first token is
  `elevenlabs/`, which `resolveRefs` already expands to every member — ADR-0008).
- skill row `elevenlabs/agents` → loads that one.

This replaces the bespoke group keys with recognition over recall (a file-manager
mental model). No new data model: the folder row round-trips through
`linesToRefs` → `parseRef` → `{kind:"source"}` unchanged.

Folder-row construction lives in **skl core** (`skillsToLinesWithFolders`,
`renderSourcePreview` in `display.ts`, unit-tested), not awk in the shell;
`bin/pick` stays thin. `skl preview source/` now renders the group's member list
(it previously errored, rejecting a group ref at `resolve.ts`).

Two smaller fixes fold in:

- **Search is scoped to the ref** (`--nth=1`), not the hidden description. Fuzzy-
  matching the description shattered grouping — typing `elev` dragged in unrelated
  skills whose *description* contained the subsequence, orphaned under the wrong
  header. Ref-scoped search keeps groups honest. Fuzzy (not `--exact`) stays: good
  matches rank top; a few weak cross-source subsequence matches (a source prefix
  can contain the query) rank low and are acceptable. **Trade:** no always-on
  concept-search over descriptions; it can return later as an explicit toggle.
- **Preview starts hidden**, toggled with `ctrl-/`, so the list is scannable by
  default.

**Group-install confirm.** `alt-i` on a folder installs the whole group, and
`--stdin` skips skl's own whole-source confirm (`cli.ts` — selection *is* the
confirmation for concrete rows). So `bin/pick` guards group installs in the popup's
real TTY: if any selected ref ends with `/`, it lists the group ref(s) and prompts
before `skl install --stdin`. Concrete-only selections install as before.

## Consequences

- The picker pipeline is now `skl list --folders | fzf --nth=1 … | skl load
  --stdin` with a hidden preview + `ctrl-/`. See the updated ADR-0004.
- `skl preview source/` is a supported command (exit 0), used by the folder row's
  preview pane.
- The old flat `skl list` (no `--folders`) is unchanged, so non-picker callers and
  tests keep the ungrouped list.

## Note on ADR-0008

ADR-0008 parked "nested display within a source". This ADR does *not* nest — it
adds a flat folder row per source, which is the group-as-entry the picker needed
without a tree.
