# Context

Working glossary and domain notes for `skl`. Terms here are meaningful to the tool's
domain, not implementation trivia.

## `skl` — deliberate skill loader

A tmux-based tool for **deliberately** loading agent skills into a running agent
session, as an alternative to autoloaded skills.

### Skill source path

One or more **configured directories** the loader scans for skills. Distinct from
`~/.agents/skills/` (the canonical autoload set that `skillsync` symlinks into each
agent). Default will be a dedicated skills repo/folder (to be created); `~/.agents/skills`
is usable as a test fixture for now.

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

## Resolved decisions

- **Source paths**: configurable, multiple. Default = a dedicated skills repo/folder
  (TBD). `~/.agents/skills` usable as a test fixture.
- **Trigger/target**: tmux popup (keybind) → fzf picker → `send-keys` into the pane it
  was summoned from. Thin wrapper over a testable CLI (`skill-load`-style).
- **Runtime**: Bun + TypeScript, **zero external deps** (Bun.file/Bun.spawn/Bun.Glob).
  Functional core (discovery, frontmatter parse, pointer render) pure + unit-tested;
  imperative shell (fs, tmux) thin. `bun test`.
- **Home**: lives in a folder in the dotfiles repo to start; may graduate to its own
  package/repo later (see Command + location).
- **Submit behaviour**: never press Enter by default — you may stack multiple skills
  then submit yourself. (Auto-submit could be an opt-in flag later.)
- **Multi-select**: picker supports selecting several skills at once (fzf Tab, like
  `tmk`); each selected skill injects its own pointer.
- **Command + location**: command is `skl`; Bun project root at `~/.config/skl/`
  (`src/`, `tests/`, `package.json`, `config.json`, plus this `CONTEXT.md` and
  `docs/adr/` co-located in the project — not at `~`). `~/.local/bin/skl` is a thin
  launcher shim (`exec bun ~/.config/skl/src/cli.ts "$@"`) — the only thing in `bin`.
  Dotfiles-tracked for the MVP; **intent to extract to a standalone `~/git/skl` repo**
  once it stabilises.
- **Path config**: JSON config file (ordered sources `{ path, name? }`) is source of
  truth, parsed + validated at the boundary; `--path` (repeatable) overrides for
  tests/agents. The pure core takes paths as plain args — no env/fs reads inside it.
  Committed with `~`/`$HOME`-relative paths (tilde-expanded at load) for portability;
  machine-specific roots via `--path` or an uncommitted local override, never absolute
  paths in the committed config. New tracked paths (`~/.config/skl/**`, `~/.local/bin/skl`)
  need `.gitignore` un-ignore patterns before `dotfiles add`.
- **Frontmatter parsing**: `Bun.YAML.parse` (native in Bun 1.3.14, zero-dep) on the
  extracted `---` fenced block; validate `name`/`description` are strings at the boundary
  → `Result`. No hand-rolled YAML, no Zod.

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
