# Shotpath (Raycast)

Private, local Raycast extension wrapping the `shotpath` shell command. Pick an SSH
host, upload the screenshot that's already on your clipboard, and get the remote path
copied back — ready to paste into a remote tmux/agent.

It is a thin wrapper: `shotpath` stays the source of truth for clipboard/image/upload
behaviour **and** SSH host parsing. The extension only provides the host picker, the
last-used ordering, and the toast/HUD feedback.

## Flow

1. Copy a screenshot to the clipboard (e.g. `⌘⌃⇧4` for a region).
2. Run **Copy Remote Shot Path**.
3. Pick a host (last-used floats to the top).
4. The extension runs `shotpath --host <host>`; on success the remote path is on your
   clipboard and a HUD confirms it. Paste it wherever you need.

If no image is on the clipboard, the command shows an empty state instead of a host list,
and re-checks at upload time.

## Requirements

- `shotpath` on disk (this repo's dotfiles install it at `~/.local/bin/shotpath`).
- The host list comes from `shotpath --list-hosts`, which parses `~/.ssh/config`.
- `ssh`/`scp` must be non-interactive from a GUI context: agent loaded, host keys in
  `known_hosts`. A passphrase/host-key prompt will fail (no TTY under Raycast).

### Preferences

- **shotpath Binary** — absolute path to the `shotpath` executable. Blank ⇒
  `~/.local/bin/shotpath`. `~` is expanded.

The extension prepends the nix profile + Homebrew bin dirs to the child's `PATH` so
`shotpath` can find its nix-managed `pngpaste`/`ssh`/`scp`/`pbcopy` under Raycast's
minimal GUI `PATH`.

## Develop / install

This is never published to the Store; it's installed as a local dev extension.

```bash
pnpm install
pnpm dev        # ray develop — builds and imports into Raycast (persists after Ctrl-C)
pnpm build      # ray build -e dist — full type-check
pnpm lint       # ray lint
```

`ray develop` hot-reloads while running and leaves the command installed after you stop it.
Re-run it to apply code changes; remove the extension via Raycast's *Manage Extensions*.

### Note: `undici-types` override

`package.json` pins `undici-types` to `6.23.0` via `pnpm.overrides`. `@types/node@22`
depends on `~6.20.0`, but undici-types `6.20.0`/`6.21.0` were published **without** SLSA
provenance — which trips pnpm's `trustPolicy: no-downgrade`. `6.23.0` is the earliest
version that restored provenance (negligible type drift, types-only package), so the
override keeps the global supply-chain posture strict rather than excluding the package
from trust checks.

## Security posture

Local-push only — no daemon, no bridge, no remote clipboard pull. The remote only ever
receives a single image you selected by a local action. On success the clipboard flips
from the screenshot image to the path text, so sending the same shot to a second host
needs a re-copy.
