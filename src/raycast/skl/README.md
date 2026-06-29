# Skill Loader (skl)

Browse the [`skl`](../../../.config/skl) skill catalogue from Raycast and copy or
paste a skill pointer — the same payload `skl` injects into a tmux pane, but
usable **outside tmux** (claude.ai, a bare terminal, any editor).

It recreates the `tmux prefix + Alt-s` picker:

- **Search Skills** — a list of every catalogue skill, grouped by source
  (`public`, `personal`, `vendor`, `vendored`), with a live pointer preview.

## Actions

**Pointer** - the agent reads SKILL.md itself (needs a shared filesystem):

| Action | Shortcut | What it does |
| --- | --- | --- |
| Copy Skill Pointer | `↵` | Copy `<name> <pointer body>` to the clipboard (the `ctrl-y` equivalent) |
| Paste Skill Pointer | `⌘↵` | Paste the pointer into the frontmost app (the `↵`/inject equivalent) |

**Inline** - the full content travels with the paste (for web chats, no filesystem):

| Action | Shortcut | What it does |
| --- | --- | --- |
| Copy Inlined Skill | `⌘I` | Copy SKILL.md + every text file, wrapped in `<file>` tags |
| Paste Inlined Skill | `⌘⇧I` | Paste the full bundle into the frontmost app |

Plus `⌘⇧C` Copy Reference (`source/name`) and `⌘D` Toggle Preview.

## How it works

The command shells out to the `skl` CLI as the single source of truth:

- `skl list` populates the list.
- `skl preview <ref>` renders the preview and the pointer text.
- `skl inline <ref>` renders the full content bundle.

Unlike `skl --copy` (which writes via tmux's OSC52 buffer and only works inside
tmux), this uses Raycast's native `Clipboard` API, so it works anywhere.

## Requirements

- The `skl` CLI on `~/.local/bin/skl` (set a custom path in preferences if elsewhere).
- `bun` resolvable via the mise shim — handled automatically by the extension's PATH.

## Development

```bash
pnpm install
pnpm dev      # ray develop — hot reload into Raycast
pnpm lint
pnpm build    # ray build -e dist — full type-check
```
