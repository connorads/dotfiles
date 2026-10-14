# BB plugins

One pnpm workspace with one directory per BB plugin. Each plugin keeps its own
`package.json`, tests and SDK pin. The workspace shares one lockfile and the
pnpm quarantine settings. Decisions that span plugins are recorded in
[docs/adr/](docs/adr/).

## Add a plugin

1. Run `bb plugin new <name>` here. Rename `bb-plugin-<name>/` to `<name>/`.
   Delete any lockfile or `pnpm-workspace.yaml` it creates.
2. Run `pnpm install` in this directory.
3. Run `pnpm build` in `<name>/`.
4. Install it: `bb plugin install path:~/src/bb-plugins/<name>`.

After an edit, run `pnpm build` and `bb plugin reload <id>`. Or run `pnpm dev`
to rebuild and reload on save.

## Checks

- `pnpm -r test` and `pnpm -r typecheck` run every plugin.
- The `ts-tests-scoped` and `ts-typecheck-bb-plugins` hooks gate commits.
- Each `tsconfig.json` must also pass the global `tsc` 7 that the hook runs.

## Header chips

Every thread-header action uses the shared [chip](chip/README.md) package. After a
change to `chip/`, run `pnpm build:chip` to rebuild each plugin that depends on
it, then reload them.
[ADR 0002](docs/adr/0002-shared-header-chip-package.md) records why.

## Agent Switcher

[Agent Switcher](claude-profiles/README.md) chooses the model, saved effort and
Claude Code account for a thread, and shows agent usage. Its plugin ID is
`claude-profiles`. [ADR 0001](docs/adr/0001-consolidate-agent-switcher.md)
records why it absorbs Model Favourites and Agent Usage.

## File-managed preferences

[Preferences](preferences/README.md) applies tracked keyboard settings from
`~/.config/bb/preferences.json`. Its guide covers installation and ownership.

## Voice controls

[Handsfree](handsfree/README.md) connects Hex commands to the focused BB window.
It provides thread navigation, draft creation, model selection and a command card.

## Composer keys

[Composer Keys](composer-keys/README.md) gives BB's text fields terminal-style
keys. Alt+Enter adds a newline in the composer and question box, and Enter
submits a typed question answer. Escape stops the running agent. Escape twice
on an empty composer opens a picker that rewinds or forks from an earlier
message.

## Keep awake

[Caffeine](caffeine/README.md) keeps this Mac awake from BB: indefinitely, for a
set time, with the lid closed, or while agents run. Alt+K opens it. It drives the
tmux caffeine lib, so the BB chip and the tmux pill always agree.

## Chat links

[External Links](external-links/README.md) adds an arrow beside chat web links.
The arrow opens the system browser. Link text follows BB's browser preference.
