# Diff Viewer

A side panel that shows every changed file of the thread's checkout in one
continuous scroll. It is a calm reader in the style of `critique`, drawn with
BB's own diff component.

Open it with `Cmd+Shift+D`, with **Open diff viewer** in the command palette,
or from the thread panel's new-tab list. On Linux the shortcut is
`Ctrl+Shift+D`. Rebind it in Settings → Keyboard.

## Scopes

| Scope | Compares | Notes |
| --- | --- | --- |
| Uncommitted | `HEAD` against the work tree, staged changes included | Untracked files appear in normal repositories. The home checkout shows tracked files only. |
| Unpushed | merge base of `@{upstream}` (else `origin/HEAD`) and `HEAD`, against `HEAD` | One cumulative diff. The commit list above the files narrows it to one commit. |
| Branch | merge base of the default branch and `HEAD`, against the work tree | The default branch is `origin/HEAD`, else `origin/main`, `origin/master`, `main` or `master`. A note says when Branch equals Unpushed or Uncommitted. |

`origin/HEAD` records the remote's default branch at clone time. If Branch
picks the wrong base, run `git remote set-head origin --auto`.

## Reading

- A compact file index sits at the top. Click a row to jump to its file.
- Each file is a card whose header sticks while its diff scrolls past. The
  header shows the status letter, the path (old → new for a rename), the
  `+`/`−` counts, and tags for untracked files and lockfiles.
- Click a header to collapse or expand that file. The toolbar collapses or
  expands every file.
- The toolbar switches between unified and split views. The choice persists.
- The scroll continues one panel height past the last file. A jump to the
  last file therefore puts its header at the top, even before its diff loads.

| Key (focus in the panel) | Action |
| --- | --- |
| `j` or `n` | Next file |
| `k` or `p` | Previous file, or the top of the current file |
| `x` | Collapse or expand the current file |
| `Shift+X` | Collapse or expand all files |
| `s` | Unified or split view |
| `r` | Refresh |

Files appear in file-tree order: directories before files, natural name order,
lockfiles last.

| File | Handling |
| --- | --- |
| Lockfile (`pnpm-lock.yaml`, `Cargo.lock`, `*.lock` and similar) | Collapsed. Its patch loads when expanded. |
| Deleted | Collapsed. Expand to read the removed lines. |
| Binary | "Binary file", with no patch. |
| Pure rename, copy or mode change | One line, such as "Renamed without changes" or "Mode 100644 → 100755". |
| Over 1,000 lines or 200 KB | Truncated at a hunk boundary, with "Show all" (up to 25,000 lines or 2 MB). |
| Over 5,000 changed lines, or an untracked file over 512 KB | A "Load diff" button. |
| Past the first load's budget (40,000 lines, 100 untracked files) | Loads when scrolled near. |

## Refresh

The panel reloads when the scope changes and on the refresh button. While the
panel is open and visible, it also checks a fingerprint of the checkout every
4 seconds and when the window regains focus, and reloads only when the
fingerprint changed. The fingerprint is a hash of `git status --porcelain=v2
--branch` plus the size and mtime of each listed file, so it sees HEAD moves,
commits, new files and further edits to a modified file. A refresh keeps the
scroll position, collapse choices and any "Show all" expansions.

## How it works

```mermaid
flowchart LR
  Panel[Panel in the app] -- rpc load / file --> Server
  Server -- thread → environment → host and path --> Host[Host worker on the checkout's machine]
  Host -- execFile git argv --> Git[(Repository or ~/git/dotfiles)]
```

- The host worker runs every git command, so a remote checkout works the
  same as a local one. Commands use `execFile` with an argument array, never a
  shell string.
- One load runs `--name-status` and `--numstat`, plans which patches to read,
  then reads them in one `git diff`. Each untracked file is one
  `git diff --no-index`, eight at a time.
- Reads never write the index. A work-tree `git diff` refreshes stat data
  into the index even with `GIT_OPTIONAL_LOCKS=0`, so git also runs with
  `diff.autoRefreshIndex=false`. A file whose stat data changed but whose
  content did not appears in `--name-status` only, and is dropped.
- Every variable from `git rev-parse --local-env-vars` is removed from the
  child environment. A hook's `GIT_INDEX_FILE` therefore cannot redirect git.
- Output ignores user diff config: no colour, no external diff, short
  submodule lines, fixed `a/` and `b/` prefixes, rename detection on and
  literal pathspecs.
- A whole-file read of an untracked path succeeds only for a file that
  `ls-files --others --exclude-standard` lists, so an ignored file such as
  `.env` is never read.
- The home checkout is not a repository, so BB's own Changes panel reports
  `non_git_environment` for it. When the checkout is `~` itself, this plugin
  uses `--git-dir ~/git/dotfiles --work-tree ~`, as `lgdf` does. It never
  lists untracked files there, because that would scan all of `~`.

## Code

| Module | Behaviour |
| --- | --- |
| `src/patch.ts` | Split a multi-file diff into per-file records: paths (quoted, renamed, binary), status, counts |
| `src/stat.ts` | Parse `--name-status -z`, `--numstat -z` and `ls-files --others -z` |
| `src/scope.ts` | Scope to git argv, unpushed base, default branch, Branch note |
| `src/files.ts` | Lockfile detection, file order, first-load plan |
| `src/truncate.ts` | Cut a patch at hunk boundaries, recounting a cut hunk's header |
| `src/view.ts` | Collapse defaults, totals, next and previous file |
| `src/git.ts`, `host.ts` | Host-side git, tested on throwaway repositories and a bare dotfiles repository |
| `server.ts` | Thread to checkout, then a host call |
| `app.tsx`, `file-card.tsx` | The panel, the command and the file cards |

Run `pnpm test`, `pnpm typecheck` and `pnpm build` in this directory. The app
code is checked by types only, because the workspace has no DOM test runner
for this plugin.

## Limits

- Untracked files in the dotfiles checkout never appear.
- A checkout below `~` that no repository encloses shows "not a git work
  tree". The dotfiles fallback applies only to `~` itself.
- The diff renders from the patch alone. BB's expand-context controls need both
  full file sides (`experimental_fullFileContents`), which the plugin does not
  load.
- Binary images show no preview.
