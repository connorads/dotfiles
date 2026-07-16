# Context

Working glossary and domain notes for `skl`. Terms here are meaningful to the tool's
domain, not implementation trivia.

## `skl` — deliberate skill loader

A tmux-based tool for **deliberately** loading agent skills into a running agent
session, as an alternative to autoloaded skills.

### Skill source path

One or more **configured directories** the loader scans for skills. Distinct from
`~/.agents/skills/` (the autoload set that `skillsync` symlinks into each agent — kept
**empty** by design so nothing autoloads). The configured sources are the **catalogue
tier**: the curation home at `~/.config/skills/` — `public` (label `mine`), `private`,
and the `vendor/.agents/skills` project dir (label `vendor`). See
`~/.config/skills/AGENTS.md` for the tier model and curation rubric — that's curation
intent, not `skl`'s domain.

### Autoloaded skill

A skill registered via `skillsync` whose `description` causes the agent to trigger it
automatically. The loader deliberately operates *outside* this mechanism — skills it
loads are not registered/triggering; they are pulled in on demand.

### Load (deliberate)

The act of making a chosen skill available to the agent *right now*, without it being
autoloaded. Mechanism: inject a **pointer** (see below) into the active agent's tmux
pane via `tmux send-keys`; the agent then reads the SKILL.md itself.

### Pointer

The minimal payload injected on load: skill name, absolute path, a `tree` of the
skill's files, and a one-line instruction ("Read SKILL.md at this path and follow it").
Deliberately *not* the SKILL.md content — keeps injected context tiny and honours
progressive disclosure.

The file tree is a **payload tree**: useful runtime files under the skill dir after
built-in and configured payload excludes have removed maintainer-only evals and
generated/cache artefacts such as
`__pycache__`, `.pyc`, `.DS_Store`, `.git`, `.claude`, `.rumdl_cache`, `*.backup`, and
`node_modules`, plus the root `evals/` directory. The root `SKILL.md` is always retained;
nested files with that name still respect exclusions. Pass `--all` to show the raw
sibling payload list for that invocation.

### Inline bundle

The **inverse** of a pointer: SKILL.md *plus every retained text file under the skill
dir*, inlined verbatim and wrapped in `<skill>`/`<file path="…">` tags (`skl inline
<ref>`).
For a target with **no filesystem access** — a web chat, a pasted prompt — the pointer's
"read SKILL.md at `<path>`" is useless, so the content has to travel with the paste.
Binaries (NUL-byte sniff) are skipped after payload filtering. XML-ish tags rather than

``` fences because skill files are themselves full of fences. See ADR-0005.

### Payload filtering

`skl` decides what to show an agent, so it applies explicit payload filters rather than
reading `.gitignore`. Defaults:

```json
[
  "**/.DS_Store",
  "**/.git/**",
  "**/.claude/**",
  "**/.rumdl_cache/**",
  "**/__pycache__/**",
  "**/*.py[cod]",
  "**/*.backup",
  "**/node_modules/**",
  "evals/**"
]
```

Config may add top-level excludes that apply to every source and per-source excludes:

```json
{
  "exclude": ["**/.venv/**"],
  "paths": [
    {
      "path": "~/.config/skills/vendor/.agents/skills",
      "name": "vendor",
      "exclude": ["**/tmp/**"]
    }
  ]
}
```

Effective excludes are built-ins + top-level `exclude` + source-level `exclude`. Patterns
use Bun glob syntax against paths relative to the skill directory. There is no `.gitignore`
negation or comment semantics in v1. `--all` disables payload excludes for previews,
loads/copies, stdin loads, and inline bundles; it does not change source discovery.

### History record

One JSONL line appended per **successful** load (inject or copy) to the machine-local
usage log at `${XDG_STATE_HOME:-~/.local/state}/skl/history.jsonl`:
`schema_version`, ISO-8601 UTC `ts`, `source`, `name`, `mode` (`inject`/`copy`),
`target` (pane id, or null for copies), `submit`. Best-effort - a failed write warns
on stderr and never fails the load. `skl history` summarises the file into
`count  source/name  last <date>` rows. `SKL_HISTORY_FILE` overrides the path (test
seam). See ADR-0007.

## Resolved decisions

- **Source paths**: configurable, multiple. Default = the three curation-home sources
  (`~/.config/skills/{public,private,vendor/.agents/skills}`, labelled
  `mine`/`private`/`vendor`). `~/.agents/skills` is *not* a source — it's the (empty)
  autoload dir; use `--path` for any ad-hoc fixture.
- **Trigger/target**: tmux popup (keybind `prefix + A`) → fzf picker → inject into the
  pane it was summoned from. The picker is a **shell pipeline**, not Bun-driven:
  `skl list | fzf --preview 'skl preview {1}' | skl load --stdin --target <pane>`
  (`bin/pick`, symlinked `~/.local/bin/skl-pick`). fzf runs in the popup's real TTY —
  the `skl` CLI never spawns it. The CLI stays a thin, TTY-free wrapper over the core.
  See ADR-0004 for why the earlier Bun-spawned fzf was dropped.
- **Runtime**: Bun + TypeScript, **zero external deps** (Bun.file/Bun.spawn/Bun.Glob).
  Functional core (discovery, frontmatter parse, pointer render) pure + unit-tested;
  imperative shell (fs, tmux) thin. fzf orchestration is shell, not Bun. `bun test`.
- **Home**: lives in a folder in the dotfiles repo to start; may graduate to its own
  package/repo later (see Command + location).
- **Submit behaviour**: never press Enter by default — you may stack multiple skills
  then submit yourself. (Auto-submit could be an opt-in flag later.)
- **Multi-select**: picker supports selecting several skills at once (fzf Tab, like
  `tmk`); each selected skill injects its own pointer.
- **Copy to clipboard**: `skl load --copy` (picker: ctrl-y, via fzf `--expect`) writes
  the pointer(s) to the system clipboard instead of injecting — `tmux load-buffer -w`
  (OSC52 via `set-clipboard on`), no pbcopy/xclip platform branching. A multi-select
  batch is one joined clipboard write (a second write would clobber the first). The
  named tmux buffer remains as a fallback (choose-buffer / prefix + =; named buffers
  sit outside the automatic stack, so prefix + ] won't see them).
- **Command + location**: command is `skl`; Bun project root at `~/.config/skl/`
  (`src/`, `tests/`, `bin/`, `package.json`, `config.json`, plus this `CONTEXT.md` and
  `docs/adr/` co-located in the project — not at `~`). `~/.local/bin/skl` is a thin
  launcher shim (`exec bun ~/.config/skl/src/cli.ts "$@"`); `~/.local/bin/skl-pick`
  symlinks `bin/pick`, the fzf picker glue. The launcher shim is the only Bun-facing
  thing in `bin`.
  Dotfiles-tracked for the MVP; **intent to extract to a standalone `~/git/skl` repo**
  once it stabilises.
- **Path config**: JSON config file (ordered sources `{ path, name? }`) is source of
  truth, parsed + validated at the boundary. Optional `exclude` arrays can appear at the
  top level and per source. `--path` (repeatable) overrides for tests/agents and keeps
  only the built-in payload excludes. The pure core takes paths as plain args — no env/fs
  reads inside it.
  Committed with `~`/`$HOME`-relative paths (tilde-expanded at load) for portability;
  machine-specific roots via `--path` or an uncommitted local override, never absolute
  paths in the committed config. New tracked paths (`~/.config/skl/**`, `~/.local/bin/skl`)
  need `.gitignore` un-ignore patterns before `dotfiles add`.
- **Frontmatter parsing**: `Bun.YAML.parse` (native in Bun 1.3.14, zero-dep) on the
  extracted `---` fenced block; validate `name`/`description` are strings at the boundary
  → `Result`. No hand-rolled YAML, no Zod.
- **Usage history**: every successful load appends a history record (see glossary) to
  `~/.local/state/skl/history.jsonl` - machine-local, deliberately dotfiles-untracked
  telemetry for catalogue curation. Readout via `skl history` (needs no config or
  discovery). Not fzf `--history` (records typed queries, not selections, and misses
  CLI/`--stdin` loads). ADR-0007.

### Source

A configured root directory of skills, given a short **label** (set in config, or
defaulting to the root dir's basename). Sources are meaningful, not just dedup buckets
(e.g. `myrepo` = curated personal repo, `fixture` = agentskills test set).

### Skill identity

`(source, name)`. `name` comes from `SKILL.md` frontmatter (falls back to dir name).
Skills discovered via `Bun.Glob("**/SKILL.md")` under each source root.

### Reference grammar

- **Bare** `skl <name>` → resolves by config **order** (PATH semantics, first source
  wins) and **prints the resolved source** (visibility of system status).
- **Qualified** `skl <source>/<name>` → exact, unambiguous.
- **Popup** tags every row with its source (`source/name`), so collisions are visible
  and you pick the intended copy directly.
- **Config** lists ordered sources `{ path, name? }`; order = precedence.

## Known refinements (not core)

- **Readable paste trick**: agent CLIs collapse bracketed pastes into a
  `[Pasted text +N lines]` blob, hiding which skill was loaded. Mitigation: inject the
  **skill name as visible literal keystrokes**, then a space, then the rest (path/tree/
  instruction) as the collapsible paste — so stacked skills stay identifiable in the
  input. Delivery-formatting concern of the imperative shell, not the pointer payload.
