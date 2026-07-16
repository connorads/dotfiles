# Vendored-skill patches

Declarative local patches for the vendored skills under `.agents/skills/`.
Each patch strips or rewrites an upstream directive we do not want injected
into agent sessions (today: "self-install/refresh skills at task time"
directives that bypass the pin-and-review vendoring posture).

Engine: `skill-patch` (`~/.config/zsh/functions/patch/skill-patch`, on PATH).

```bash
skill-patch check    # exit 0 iff every hunk is applied (hk runs this on commit)
skill-patch apply    # idempotent; re-applies hunks clobbered by `skills update`
skill-patch status   # per (patch, target, hunk) state table
skill-patch list     # patch names + reasons
```

## Format

One directory per patch:

```text
patches/<name>/
  patch.json      meta: reason, files, optional vars
  01-find.md      verbatim upstream text to replace
  01-replace.md   verbatim local text it becomes
  02-find.md …    further hunks, numbered
```

`patch.json` fields:

- `reason` (string, single line) - why the patch exists. Also generates the
  marker comment (see tokens below), so it is never hand-maintained.
- `files` (string array) - target paths relative to this dir's parent
  (the vendor root), e.g. `.agents/skills/figma/SKILL.md`.
- `vars` (optional object) - each key maps to a string array; the engine takes
  the cross-product and expands `{{key}}` in both `files` entries and hunk
  text. Lets N identical per-skill edits live as one patch with an explicit,
  reviewable name list.

Hunk files are **verbatim bytes**: exactly one trailing newline is stripped,
then the rest must match the target byte-for-byte. No escaping - `dotfiles
diff` on a re-derived hunk reads like the skill diff itself. A hunk that spans
whole lines therefore ends at the last matched character, not at a trailing
newline; single-line hunks are just the line.

Tokens:

- `{{<var>}}` - from `vars`, expanded in paths and hunk text.
- `{{marker}}` - replace hunks only, opt-in per hunk. Expands to
  `<!-- LOCAL PATCH (connorads dotfiles): <reason> -->` so refresh diffs
  surface the patch. Not every hunk needs one (e.g. a paragraph rewrite next
  to a marked hunk in the same file).

## States

Per (target, hunk), `skill-patch` classifies:

| State | Meaning | Action |
| ----- | ------- | ------ |
| `applied` | replace text present, find text absent | none |
| `pending` | find text present exactly once | `skill-patch apply` (a refresh clobbered it) |
| `ambiguous` | find text present more than once | tighten the find hunk; the engine refuses to guess |
| `broken` | neither present | upstream drifted - re-derive the hunk (below) |
| `missing-target` | target file gone | skill removed upstream? fix or remove the patch |

Malformed `patch.json` / unpaired hunk files exit 2.

## Procedures

**Add a patch:** create the dir, write `patch.json` and hunk pairs (copy the
upstream text verbatim into `NN-find.md`, the desired local text into
`NN-replace.md`, `{{marker}}` where a visible marker helps), run
`skill-patch apply`, review `dotfiles diff`, stage the patch dir with the
patched skill.

**Re-derive after upstream drift** (`check` reports `broken`): the refresh
diff shows the new upstream text. Update `NN-find.md` to the new upstream
bytes (and `NN-replace.md` if the local text should track it), `skill-patch
apply`, stage the patch dir together with the skill. If upstream removed the
offending directive entirely, delete the hunk pair (or the whole patch dir)
instead - that is the deliberate-removal escape hatch the hk guard respects.

**Remove a patch:** delete its dir (or one skill from `vars`) in the same
commit as the un-patched skill content.

## Provenance

Migrated from hand-applied edits (commit `f8398b29`, 2026-07-16): the
hyperframes router sections, the 11 hyperframes workflow "keep this skill
fresh" blockquotes, and the two next.js adoption skills' task-time
`npx skills add next-dev-loop` directives. Find hunks recovered byte-exactly
from `f8398b29^`.

## Scope

Targets are vendor-root-relative, so only this tier is covered. Patches for
the global autoload tier (`~/.agents/skills/`, e.g. `playwright-cli`) are a
future extension - no such patch exists today.

Enforcement: the hk `vendored-skill-patches` step runs `skill-patch check` on
every commit touching vendored skills or `patches/**`; `~/hk.pkl` also
excludes `patches/**` from formatting steps (hunk files mirror upstream
bytes and must not be reformatted).
