---
name: disk-reclaim
description: >-
  Finds what is consuming disk space on this Mac and reclaims it safely. Use
  when the disk is low or full, or the user asks to analyse disc usage, find
  what's eating space, free up space, or clean up their Mac — including
  mentions of ncdu, du, dust, or "startup disk full". Not for pruning a single
  project's build output, or for disk on a remote server.
---

# Disk reclaim

Every byte is **rebuildable**, **re-downloadable**, or **irreplaceable**.
Reclaim the first freely, the second with a nod, the third never. Sort anything
this skill doesn't name into one of those three and act accordingly.

The biggest number is rarely the right first target: a 60G game is one click to
restore, a 6G photo library is gone forever.

## Survey before promising

1. `df -h /System/Volumes/Data` for the real figure.
2. `cleanup --dry-run` sizes its known cache targets without touching anything
   (`--json` to parse it, `cleanup --help` for the target list). Do this
   *before* hand-rolling deletion, but do not mistake it for a complete cache
   inventory.
3. Then probe `~/Library/Caches` as well as the large home directories.
   Individual tools use different cache roots - for example, a browser cache
   can live there while `cleanup` checks only `~/.cache`.
4. Only then drill. `du -sh ~/* ~/.[!.]*` is slow on a large home - background
   it, or use `dust`. Scan named roots separately: cloud-managed or protected
   trees can stall a broad scan. A stalled path is unclassified, not zero.
   `ncdu` is for the user to drive: it's a TUI and gives an agent nothing
   non-interactively.
5. Reconcile `du` home subtotals against the `df` *used* figure before
   concluding. Home rarely equals the disk: a large shortfall lives outside
   `~` - probe `/private/tmp`, `/opt/homebrew`, `/nix`, `/Library`. On a
   shared APFS container every volume's `df` reports the *same* container
   free, so read one volume, don't sum them.

Quote a reclaim estimate only for things you have actually probed. Sizes on
this machine change; check every time rather than trusting a remembered figure.

Where large things tend to hide: `~/Library/Application Support` (games, model
weights), Rust `target/` dirs under repos, `~/Downloads`, LLM/Whisper model
stores, and `/private/tmp` (dev/agent scratch accumulates there and is cleared
only on reboot, so a long-uptime Mac hoards tens of GB) - reclaim it by
rebooting or deleting named entries.

## What may be deleted

| Class | Examples | Rule |
|---|---|---|
| Rebuildable | `target/`, `node_modules/`, caches | Proceed |
| Re-downloadable | Steam games, LLM/Whisper models, media rips | Name it and the size, proceed on a nod |
| Irreplaceable | Photos, documents, anything authored | Never without an explicit yes |

**Ask before deleting anything in `~/Downloads`** — it mixes all three classes.
Zip-alongside-extracted-folder pairs are the reliable safe win there; media is
the user's call, however obviously disposable it looks.

Treat an active project's build tree differently from an idle one. It is
rebuildable, but cleaning it during active work is short-lived headroom and
forces an expensive rebuild; prefer other candidates first and make that
trade-off explicit.

Untracked is not disposable: a gitignored `.cache/` or output tree can hold
expensive-to-rebuild artefacts or irreplaceable captures, so sort its contents
by the three classes - don't clear it wholesale because git ignores it. A
project cleaner or its docs, where present, is the fastest classifier.

## Gotchas

- **`rm -rf` is denied by settings.** Reach for the idiomatic cleaner instead:
  `cleanup --target <id> --yes`, `cargo clean`, `uv cache clean`, `pnpm store
  prune`. `rm -f` on named files is allowed. Bundling several removals into one
  command gets the whole command denied, so keep them separate.
- **A mounted DMG under `/tmp`** (cask/`.pkg` install leftover) reports
  `Read-only file system` and blocks its parent's deletion until
  `hdiutil detach /dev/diskN` (find it via `hdiutil info`); the leftover
  `.cdr`/dir then clears with `rm -f`/`rmdir`.
- **Rust build dirs: `cleanup --target cargo-target --yes`** (opt-in; scans
  `$CLEANUP_CARGO_ROOTS`). `cleanup`'s `cargo` target is the registry cache
  only and does not touch `target/`. These dirs get large enough to dominate a
  survey while `.git` beside them stays small.
- **Aube:** `~/.cache/aube/virtual-store` is a live mise npm-tool working set,
  not disposable cache. Do not delete it: it leaves mise tool shims dangling.
  `aube store prune` is the supported way to reclaim unreferenced package data;
  its saving may be zero and cannot be estimated from the whole store size.
- **mise HTTP tarballs:** `mise prune` can remove an old tool while extracted
  archives remain under `~/.local/share/mise/http-tarballs`, even when
  `mise cache path` points elsewhere. For a large entry, read `metadata.json`
  and confirm that no installed tool or symlink references it before treating
  it as re-downloadable and removing that entry after a nod. Do not expect
  `mise cache clear` to clear this legacy root.
- **`/nix/store` size is not reclaimable space.** Most of it is live. Trust
  `cleanup`'s nix probe, which sizes dead paths only; `nix-collect-garbage -d`
  routinely frees nothing while costing rollback generations. Never quote the
  store total as a saving.
- **Podman is separate from Docker.** A stopped Podman VM can make Docker
  cleanup look empty while `~/.local/share/containers/podman/machine` remains
  large. Inspect `podman machine list`; remove a machine only with a nod,
  because it discards its images, containers, and volumes.
- **Steam: uninstall in the app**, never delete `steamapps/common/*` — the
  manifests desync. Usually the largest single win, and the user must do it.
- **Yarn v1:** do not probe `yarn cache clean` with `--help` - it runs the
  cleaner. Use `yarn cache --help` to inspect the parent command instead.
- Don't pipe a long-running background command through `tail`: the output is
  lost to buffering and you end up polling for a result that never lands.
