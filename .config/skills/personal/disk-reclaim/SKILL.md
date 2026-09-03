---
name: disk-reclaim
description: >-
  Finds what is consuming disk space on this Mac and reclaims it safely. Use
  when the disk is low or full, or the user asks to analyse disc usage, find
  what's eating space, free up space, or clean up their Mac - including
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
   inventory. Give it the login PATH: each target probes for its tool, and a
   bare non-interactive shell without mise shims or `/opt/homebrew/bin` reports
   those as `not available on this host` and silently drops them from the
   total.
3. Then probe `~/Library/Caches` as well as the large home directories.
   Individual tools use different cache roots - for example, a browser cache
   can live there while `cleanup` checks only `~/.cache`.
4. Only then drill. `du -sh ~/* ~/.[!.]*` is slow on a large home - background
   it, or use `dust`. A glob over a directory holding tens of thousands of
   entries dies with `argument list too long`; `du -d1 -xh <dir>` walks it
   instead. Scan named roots separately: cloud-managed or protected
   trees can stall a broad scan. A stalled path is unclassified, not zero. A
   per-dir scan that emits *no line* for a named directory stalled on it - that
   dir is the prime suspect, not empty; re-scan it alone with a timeout. On a
   dev machine the source root (`~/git`, `~/src`, `~/code`) is routinely the
   single largest tree and the classic stall culprit - build outputs and caches
   nested inside repos - so size it early and on its own. The one stall that is
   *not* a suspect is `~/Library/Containers` (see Gotchas). `ncdu` is for the
   user to drive: it's a TUI and gives an agent nothing non-interactively.
5. Reconcile `du` home subtotals against the volume's *own* used figure before
   concluding. **`df` is the wrong denominator for this**: on a shared APFS
   container it reports container-wide usage - Data volume plus the System
   volume, `/nix`, and snapshots - so every volume prints the *same* numbers
   and none of them is what `du ~` can add up to. Read the Data volume alone:

   ```bash
   diskutil info /System/Volumes/Data | grep 'Volume Used'
   ```

   It prints **decimal GB**; divide by 1.074 to compare with `du -h`. The gap
   is not small - one verified reading had `df` at 131G used against a Data
   volume holding 99.0 GB (92 GiB). Home rarely equals even that: a shortfall
   lives outside `~` - probe `/private/tmp`, `/opt/homebrew`, `/Library`
   (`/nix` is its own volume, so it is outside the Data figure entirely).
   Until the accounted total approaches *Volume Used*, the survey is
   unfinished: a large unexplained remainder is not a footnote, it is the
   reclaim target - keep drilling before presenting any plan.

Quote a reclaim estimate only for things you have actually probed - and that
binds the *options you offer* as much as the totals you report. Bucket a tree
before proposing a cut-off through it: dir names carry issue numbers, not
dates, and a plausible-sounding "delete everything before July" split of a
10.9G tree once freed 45M. Size the buckets, then offer the split. Sizes on
this machine change; check every time rather than trusting a remembered figure.

Where large things tend to hide: `~/Library/Application Support` (games, model
weights), Rust `target/` dirs under repos, `~/Downloads`, LLM/Whisper model
stores, and `/private/tmp` (dev/agent scratch accumulates there and is cleared
only on reboot, so a long-uptime Mac hoards tens of GB) - reclaim it by
rebooting or with `cleanup --target claude-temp --yes`. That opt-in target
removes only current-user Claude session scratch older than 60 minutes. It
protects live sessions from every configured profile and every hibernation
record, including orphaned records whose pane is gone.

## What may be deleted

| Class | Examples | Rule |
|---|---|---|
| Rebuildable | `target/`, `node_modules/`, caches | Proceed |
| Re-downloadable | Steam games, LLM/Whisper models, media rips | Name it and the size, proceed on a nod |
| Irreplaceable | Photos, documents, anything authored | Never without an explicit yes |

Before classifying a language cache, check its tool still exists:
`command -v dart flutter gradle go`. A cache whose toolchain is gone is not
"re-downloadable pending a nod", it is dead weight - `~/.pub-cache`,
`~/.gradle` and `~/.dartServer` held 1.6G between them on a machine with no
Dart, Flutter or Gradle installed at all. `go` is the same pair twice over:
`~/Library/Caches/go-build` and `~/go` (690M and 124M here) are both dead
weight with no `go` on the machine. The check extends to the *manager*:
Android's `sdkmanager` is a JVM wrapper, so with no `java` it cannot list or
uninstall the packages it installed, and the idiomatic-cleaner route is closed
before you reach it (9.1G of `system-images`, `ndk` and `emulator` sat under a
`sdkmanager` that could not run). Hand-delete those, leaving the
package-manager-owned `cmdline-tools` alone. The mirror-image failure is a
manager that runs but has no removal verb: LM Studio's `lms` has `get`, `load`,
`ls` and `import` but no `rm`, so a model comes out only by deleting
`~/.lmstudio/models/<publisher>/` once `lms ps` confirms none are loaded.

**Ask before deleting anything in `~/Downloads`** - it mixes all three classes.
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
- **Hibernated agents still own their scratch state.** Conversation persistence
  does not prove that scratch files are disposable. `cleanup --target
  claude-temp` fails closed if any live-agent query or hibernation record is
  unreadable, and refreshes both sets immediately before deletion. Do not
  hand-delete `/private/tmp/claude-<uid>` wholesale.
- **Confirm reclaim with `df`, not the command's exit code - nor its reported
  total.** macOS `/usr/bin/trash` exits non-zero if *any* path arg is missing
  while still trashing the rest, and says nothing about bytes freed; `du
  ~/.Trash` reads `0` whether or not anything is in it, because the directory
  is TCC-protected rather than empty. Cleaners that *do* report a
  figure report **apparent** size: `cargo clean` printed `Removed 704697 files,
  219.3GiB total` for a tree `du` and `df` both put at 63 GiB - a 3.5x
  overstatement from hardlinks and sparse files. Never pass a cleaner's own
  number to the user. After any delete/clean, re-check `df` (or the target's
  `du`) - that is ground truth, not exit status.
- **Trashing frees nothing until the Trash is emptied, on a GUI Mac too.** The
  bytes leave `du ~` and never reach `df`, so a session that trashes its way to
  a result cannot show the result. An agent can neither read `~/.Trash` (TCC)
  nor safely empty it - it may hold the user's own items. So for unambiguously
  rebuildable targets prefer real deletion, via an idiomatic cleaner,
  `git worktree remove` or `wt-remove`, precisely so `df` moves inside the
  session. Where `trash` is right, close by reporting how much is pending in it
  and that emptying is the user's action.
- **`trash` on a many-file tree takes minutes** (it moves, it doesn't unlink),
  so it outlives tool timeouts and gets killed mid-move, leaving some args done
  and some untouched. Background it, and verify per-path afterwards with `ls
  -d` rather than trusting one exit code for the whole list.
- **Over SSH, trashing is close to one-way, and frees nothing.** A headless
  session can neither read `~/.Trash` (that needs Full Disk Access) nor drive
  Finder (Automation consent cannot be prompted with no GUI), so
  `osascript -e 'tell application "Finder" to empty trash'` times out with
  AppleEvent `-1712`. That code means missing consent, not a wedged Finder:
  `killall Finder` changes nothing, and polling `df` for it wastes the whole
  timeout. Recovery hangs on knowing the exact names, so run `trash -v` and
  keep its `Moved "<src>" to "/Users/<you>/.Trash/<name>"` lines - the
  directory is writable even when unreadable, so `mv ~/.Trash/<name>
  /private/tmp/<name>` retrieves an item by name, and it can be deleted there.
  Where the deletion is plainly rebuildable and the box is headless, prefer a
  cleaner or an in-tmp delete over `trash` in the first place.
- **`~/Library/Containers` stalls every `du` and is never the answer.** It is
  hundreds of `com.apple.*` sandboxes (600 on this machine, all Apple, largest
  44K). It is the one directory where a stall means TCC-protected paths, not
  size - don't spend three scans on it as the "prime suspect". Confirm cheaply
  with `ls ~/Library/Containers | grep -vc '^com\.apple\.'`; if that is 0,
  move on.
- **A mounted DMG under `/tmp`** (cask/`.pkg` install leftover) reports
  `Read-only file system` and blocks its parent's deletion until
  `hdiutil detach /dev/diskN` (find it via `hdiutil info`); the leftover
  `.cdr`/dir then clears with `rm -f`/`rmdir`.
- **Rust build dirs: `cleanup --target cargo-target --yes`** (opt-in; scans
  `$CLEANUP_CARGO_ROOTS`). `cleanup`'s `cargo` target is the registry cache
  only and does not touch `target/`. These dirs get large enough to dominate a
  survey while `.git` beside them stays small.
- **Agent worktrees under `<repo>/.claude/worktrees/`** each carry their own
  build tree, so one repo holds several copies of its own `target/` (23G across
  three here, against 40G in the repo's live one). They read as irreplaceable
  because their `worktree-agent-*` branches hold unmerged commits, but
  `git worktree remove` drops only the checkout - the branch and its commits
  stay in the main repo, so a clean one goes with no loss. Check
  `git status --porcelain` in each first, and confirm the branch survives
  afterwards. Being inside the repo, they hide from a `~/git/*` scan behind the
  repo's own total.
- **Managed worktrees under `~/.trees`** are the same trap at ten times the
  size: each carries its own `node_modules` and build output (~2.4G plus ~2.9G
  each in a Next.js repo; 25 worktrees held 68G here). `wt-status --all --pr
  --json` classifies them and `wt-clean --dry-run` previews only the MERGED-PR
  set. Do not carry the branch-survives advice above across to it: **`wt-clean`
  deletes the branch too** - it hard-codes `--delete-branch`, so `git branch -d`
  runs after each removal - and `wt-clean --force` escalates that to `git branch
  -D`, which destroys unmerged commits. For the merged-but-no-PR worktrees
  `wt-clean` deliberately spares, bare `wt-remove <path>` is the
  branch-preserving primitive.
- **Several Playwright browser revisions is the normal state, not stale
  build-up.** A machine with many repos pins one revision per `playwright-core`
  version, so four chromium revisions in `~/Library/Caches/ms-playwright` can
  all be live, and pruning the "old" ones forces gigabytes of re-download.
  Resolve it rather than guessing by age: each file under `<root>/.links` names
  a `playwright-core` install, that install's `browsers.json` lists every
  `{name, revision}` it needs, and the on-disk directory is the name with
  hyphens replaced by underscores plus `-<revision>` (`chromium-headless-shell`
  becomes `chromium_headless_shell-1234`). Anything outside that set is
  unreferenced. `cleanup --target playwright` walks exactly this; `cleanup`'s
  `browsers` target historically probed `~/.cache` only and reported 0 against
  3.3G.
- **Aube:** `~/.cache/aube/virtual-store` is a live mise npm-tool working set,
  not disposable cache. Do not delete it: it leaves mise tool shims dangling.
  `aube store prune` is the supported way to reclaim unreferenced package data;
  its saving may be zero and cannot be estimated from the whole store size.
  Since mise embedded aube as a library, a newer install keeps its store
  **inside the install** at `<install>/node_modules/.mise` rather than in the
  shared cache. A sweep finds it as bulk under
  `~/.local/share/mise/installs/`, and it looks like cache because of the name.
  It is not: it is the tool's own dependency tree, and deleting it breaks the
  tool. Reclaim it with `mise prune` / uninstalling the tool, never by hand.
- **mise downloads:** `mise prune` can remove an old tool while its downloaded
  archives remain under `~/.local/share/mise/downloads/<tool>/`. That root is
  in mise's *data* dir, not its cache dir (`~/Library/Caches/mise`), so
  `mise cache clear` never touches it. For a large entry, confirm no installed
  tool still references it (`mise ls <tool>`) before treating it as
  re-downloadable and removing it after a nod. If a legacy
  `~/.local/share/mise/http-tarballs` dir still exists
  (`[ -d ~/.local/share/mise/http-tarballs ]`), the same applies there - read
  an entry's `metadata.json` before removing it.
- **APFS local snapshots pin deleted blocks.** After big deletions the `df`
  figure can refuse to move: Time Machine local snapshots keep the old blocks
  live. Inspect with `tmutil listlocalsnapshots /`; reclaim with
  `tmutil thinlocalsnapshots / <bytes> 4`, or wait - macOS thins them under
  pressure. Never quote purgeable or snapshot space as a saving; it is not
  yours to promise.
- **`/nix/store` size is not reclaimable space.** Most of it is live. Trust
  `cleanup`'s nix probe, which sizes dead paths only; `nix-collect-garbage -d`
  routinely frees nothing while costing rollback generations. Never quote the
  store total as a saving.
- **Podman is separate from Docker.** A stopped Podman VM can make Docker
  cleanup look empty while `~/.local/share/containers/podman/machine` remains
  large. Inspect `podman machine list`; remove a machine only with a nod,
  because it discards its images, containers, and volumes.
- **VM disks are sparse and never shrink.** Even a *successful* in-guest prune
  leaves host `df` unmoved: `~/.colima/_lima/_disks/colima/datadisk` is 100 GiB
  apparent against 38G allocated, and a sparse file only grows, so
  `docker system prune` frees blocks inside the guest filesystem while the host
  allocation stays put. Only `colima delete` (or the Podman equivalent) returns
  host bytes, and it discards every image, container and volume - a nod, never
  a default. Never quote a VM disk's size as reclaimable; like `/nix/store`,
  the estimate would equal the total.
  `colima delete` also leaves the *named data disk* behind (`colima list` goes
  empty while `_lima/_disks/<name>` still holds gigabytes). Check
  `LIMA_HOME=~/.colima/_lima limactl disk list` for an entry with an empty
  `IN-USE-BY` and remove it with `limactl disk delete <name>`. nix's colima
  package doesn't expose `limactl` on PATH; it lives in the `lima-full` store
  path colima references.
- **`brew cleanup -n` under-reports.** It applies brew's 120-day policy, so it
  can print nothing while gigabytes sit in `$(brew --cache)/downloads`. Use
  `cleanup --target brew` (or `brew cleanup --prune=all -n`) for the true
  figure.
- **Steam: uninstall in the app**, never delete `steamapps/common/*` - the
  manifests desync. Usually the largest single win, and the user must do it.
- **Yarn v1:** do not probe `yarn cache clean` with `--help` - it runs the
  cleaner. Use `yarn cache --help` to inspect the parent command instead.
- Don't pipe a long-running background command through `tail`: the output is
  lost to buffering and you end up polling for a result that never lands.
