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
2. `cleanup --dry-run` sizes every known cache target without touching
   anything (`--json` to parse it, `cleanup --help` for the target list). Do
   this *before* hand-rolling any cache deletion — package-manager, editor,
   container and nix caches are all already covered.
3. Only then drill. `du -sh ~/* ~/.[!.]*` is slow on a large home — background
   it, or use `dust`. `ncdu` is for the user to drive: it's a TUI and gives an
   agent nothing non-interactively.

Quote a reclaim estimate only for things you have actually probed. Sizes on
this machine change; check every time rather than trusting a remembered figure.

Where large things tend to hide: `~/Library/Application Support` (games, model
weights), Rust `target/` dirs under repos, `~/Downloads`, LLM/Whisper model
stores.

## What may be deleted

| Class | Examples | Rule |
|---|---|---|
| Rebuildable | `target/`, `node_modules/`, caches | Proceed |
| Re-downloadable | Steam games, LLM/Whisper models, media rips | Name it and the size, proceed on a nod |
| Irreplaceable | Photos, documents, anything authored | Never without an explicit yes |

**Ask before deleting anything in `~/Downloads`** — it mixes all three classes.
Zip-alongside-extracted-folder pairs are the reliable safe win there; media is
the user's call, however obviously disposable it looks.

## Gotchas

- **`rm -rf` is denied by settings.** Reach for the idiomatic cleaner instead:
  `cleanup --target <id> --yes`, `cargo clean`, `uv cache clean`, `pnpm store
  prune`. `rm -f` on named files is allowed. Bundling several removals into one
  command gets the whole command denied, so keep them separate.
- **Rust build dirs: `cleanup --target cargo-target --yes`** (opt-in; scans
  `$CLEANUP_CARGO_ROOTS`). `cleanup`'s `cargo` target is the registry cache
  only and does not touch `target/`. These dirs get large enough to dominate a
  survey while `.git` beside them stays small.
- **`/nix/store` size is not reclaimable space.** Most of it is live. Trust
  `cleanup`'s nix probe, which sizes dead paths only; `nix-collect-garbage -d`
  routinely frees nothing while costing rollback generations. Never quote the
  store total as a saving.
- **Steam: uninstall in the app**, never delete `steamapps/common/*` — the
  manifests desync. Usually the largest single win, and the user must do it.
- Don't pipe a long-running background command through `tail`: the output is
  lost to buffering and you end up polling for a result that never lands.
