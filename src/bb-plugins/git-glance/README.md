# Git Glance

A header chip shows the thread checkout's branch, ahead/behind counts and the
number of changed files. Click it or press `Alt+G` to open a pop-up with:

- pull, push and fetch, with git's own progress and a hint when one fails
- branch, upstream, stash count and any merge or rebase in progress
- conflicted, staged, unstaged and untracked files with line counts
- an inline diff for each file, in BB's diff viewer
- the last 30 commits with a lane graph; filled nodes are not on any remote.
  Click a commit for its message, author and changed files, each with a diff.
- diffs use BB's own viewer, which is built on Pierre diffs

Keys in the pop-up: `↑`/`↓` or `j`/`k` move, `↵` opens a diff, `p` pulls,
`⇧P` pushes, `f` fetches, `z` expands to a large view with side-by-side
diffs, `R` resynchronises, and `q` or `esc` closes. The size is remembered. Rebind `Alt+G`
in Settings → Keyboard. For anything else, open lazygit with its own plugin.

## Live updates

```mermaid
flowchart LR
  App[Chip in a window] -- watch lease every 30s --> Server
  Server -- first lease --> Host[Host monitor]
  Host -- FSEvents --> Filter[git-dir rules and check-ignore]
  Filter --> Refresh[one refresh at a time]
  Refresh -- changed snapshot --> Server
  Server -- realtime --> App
```

- A window leases each thread it shows. The server keeps one host watch per
  checkout while any lease lives; unrenewed leases expire after 75 seconds.
- The host watches the git dir, the common dir for linked worktrees, and the
  work tree minus its ignored top-level entries. In the git dir, lock files,
  objects and logs never trigger a refresh. In the work tree,
  `git check-ignore` drops ignored paths.
- Refreshes run one at a time; changes during a run queue one more. A snapshot
  is sent only when it differs from the last one.
- Status runs with `GIT_OPTIONAL_LOCKS=0`, so it never writes the index. A
  refresh therefore cannot trigger the watcher again or block an agent's commit.
- After a realtime reconnect or window focus, the app renews its leases, which
  returns a fresh snapshot.

## Pull, push and fetch

- Pull is `git pull --ff-only`. Diverged branches disable it: rebase or merge in
  lazygit instead.
- Push publishes a branch with no upstream to `origin`, or to the only remote.
- Opening the pop-up fetches, unless a fetch or other operation ran in the last
  two minutes.
- One operation runs per checkout. Click the running button to cancel it.
- Git never prompts. Credential helpers and a running ssh-agent work; anything
  that needs a prompt fails with a hint to authenticate in a terminal.

## Repository discovery

The home-directory checkout has no enclosing repository, so the plugin falls
back to the bare dotfiles repository at `~/git/dotfiles`, as `lgdf` does.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` from this directory.
