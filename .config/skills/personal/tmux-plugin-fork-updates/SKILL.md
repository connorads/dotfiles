---
name: tmux-plugin-fork-updates
description: Safely review, sync, and locally update forked tmux plugins. Use whenever the user mentions tmux-upstream, tmux plugin forks, `prefix + U`, a `connorads/<plugin>` fork being commits behind upstream, asks whether a tmux plugin update is dodgy/compromised/safe, or asks to sync/update a forked tmux plugin. Default to review-only and ask before syncing unless the user explicitly requested automatic safe sync.
---

# Tmux Plugin Fork Updates

Review upstream commits for forked tmux plugins, decide whether they are safe, then optionally sync the fork and update the local TPM checkout.

## Why this exists

Tmux plugins in `~/.config/tmux/tmux.conf` point at personal `connorads/*` forks so upstream authors cannot push directly into the code TPM updates with `prefix + U`. That safety only works if upstream changes are reviewed before syncing the fork.

Treat plugin updates like executable supply-chain changes: tmux plugins are shell/Python/Ruby/etc. code that may run inside the user's terminal and tmux server.

## Default policy

- **Review-only by default.** Report safe/hold first and ask before `gh repo sync`.
- **Auto-sync only when authorised.** If the user explicitly says to sync/update automatically after a clean review, proceed after the review passes.
- **Hold on anything suspicious.** Do not sync if there is instruction/code hijacking, exfiltration, obfuscation, unexplained network calls, or capability creep.
- **Respect dirty local checkouts.** If the local plugin checkout has uncommitted changes, stop and ask.

## Workflow

### 1. Identify stale plugin forks

Run the existing checker first:

```bash
tmux-upstream -v
```

It reads `~/.config/tmux/tmux.conf` and checks `connorads/*` plugin forks against their upstream parents.

If the user named one plugin, focus on that plugin. Otherwise review every plugin reported as behind.

### 2. Gather fork/upstream metadata

For each plugin, confirm it is a fork and get the default branches:

```bash
gh repo view connorads/<plugin> --json nameWithOwner,parent,defaultBranchRef,url,isFork
```

If it is not a fork, or the parent is missing/renamed, stop and ask.

### 3. Compare in an isolated temp repo

Use a temporary clone so review is independent of the local TPM checkout:

```bash
tmp=$(mktemp -d)
git init -q "$tmp"
git -C "$tmp" remote add fork https://github.com/connorads/<plugin>.git
git -C "$tmp" remote add upstream https://github.com/<owner>/<plugin>.git
git -C "$tmp" fetch -q --no-tags fork <fork-branch>
git -C "$tmp" fetch -q --no-tags upstream <upstream-branch>

git -C "$tmp" rev-list --count fork/<fork-branch>..upstream/<upstream-branch>   # behind
git -C "$tmp" rev-list --count upstream/<upstream-branch>..fork/<fork-branch>   # ahead

git -C "$tmp" log --reverse --date=short \
  --format='%h %ad %an <%ae> %s' \
  fork/<fork-branch>..upstream/<upstream-branch>

git -C "$tmp" diff --stat fork/<fork-branch>..upstream/<upstream-branch>
git -C "$tmp" diff --name-status fork/<fork-branch>..upstream/<upstream-branch>
```

If the fork is both behind and ahead, do not blindly sync. Read the ahead commits too and ask whether to preserve/rebase/drop the fork-only changes.

### 4. Review whether the update is dodgy

Read the diff, not just commit titles. Focus hardest on executable surfaces:

```bash
git -C "$tmp" diff --find-renames \
  fork/<fork-branch>..upstream/<upstream-branch>
```

Quick triage helpers:

```bash
# Non-documentation changes: highest-risk surface
git -C "$tmp" diff --name-status fork/<fork-branch>..upstream/<upstream-branch> \
  | grep -vE '\.(md|txt|png|jpg|gif|webp|cast)$' || true

# Suspicious added lines; investigate matches in context, don't judge by grep alone
git -C "$tmp" diff --unified=0 fork/<fork-branch>..upstream/<upstream-branch> \
  | rg '^\+.*(curl|wget|nc |netcat|ssh |scp |rsync|token|secret|credential|API_KEY|PRIVATE_KEY|\.ssh|\.aws|eval|exec|base64|chmod|rm -rf|bash -c|sh -c|python -c|osascript|launchctl|crontab|Popen|subprocess|requests|urllib|socket)'
```

Hold for sign-off if you see:

- **Exfiltration:** reads secrets, env vars, dotfiles, SSH keys, cloud credentials, tokens, then sends or logs them.
- **Obfuscation:** base64/hex payloads, dynamic eval/exec, hidden download-and-run flows.
- **Unexpected network behaviour:** new curl/wget/HTTP clients unrelated to the plugin's purpose.
- **Dangerous shell behaviour:** broad deletes, chmod/chown on user files, shelling through untrusted input.
- **Persistence:** launch agents, cron/systemd, shell profile edits, background daemons not previously present.
- **Capability creep:** a docs/UX tweak quietly adds scripts, installers, telemetry, or broad filesystem access.

Benign changes usually look like bug fixes, compatibility tweaks, documentation, tests, colour/display changes, or narrow logic changes that fit the plugin's purpose.

### 5. Check project context

Use GitHub PR/release context where helpful, especially for multi-commit updates:

```bash
gh pr list --repo <owner>/<plugin> --state merged --limit 20
# If commit history mentions PR numbers:
gh pr view <number> --repo <owner>/<plugin> --json title,author,mergedAt,mergedBy,commits,reviews,comments
```

PR approval is supporting evidence only; it does not replace diff review.

### 6. Verify when practical

Prefer lightweight verification proportional to the plugin:

- Run syntax checks for changed scripts when available (`bash -n`, `python -m compileall`, etc.).
- Run bundled tests if they exist and dependencies are already available.
- Do not install new packages or enable install scripts just to test a plugin unless the user approves.

### 7. Report and ask before syncing

Use this structure:

```text
<plugin>: <safe to sync | hold>
- fork: connorads/<plugin>
- upstream: <owner>/<plugin>
- behind/ahead: <N>/<M>
- missing commits: <short summary>
- changed surface: <files/categories>
- review result: <why safe or why held>
- verification: <commands run or not run>

Next: sync? (gh repo sync connorads/<plugin> + update local checkout)
```

If the user already authorised auto-sync and the review is clean, continue to the sync step instead of asking.

## Sync and local update

Only do this after explicit user approval, or when the original prompt clearly asked to sync automatically after a clean review.

### 1. Sync the GitHub fork

```bash
gh repo sync connorads/<plugin>
```

### 2. Update the local TPM checkout

The local plugin is normally under `~/.config/tmux/plugins/<plugin>`.

```bash
plugin_dir="$HOME/.config/tmux/plugins/<plugin>"
git -C "$plugin_dir" status --short
```

If dirty, stop and ask. If clean:

```bash
git -C "$plugin_dir" fetch origin <fork-branch> --quiet
git -C "$plugin_dir" pull --ff-only origin <fork-branch>
git -C "$plugin_dir" log --oneline -5
```

If `pull --ff-only` fails, do not merge. Report the state and ask.

### 3. Verify sync state

Re-check both fork and local checkout:

```bash
# In the temp compare repo, refetch and confirm fork == upstream
git -C "$tmp" fetch -q fork <fork-branch>
git -C "$tmp" fetch -q upstream <upstream-branch>
git -C "$tmp" rev-list --count fork/<fork-branch>..upstream/<upstream-branch>
git -C "$tmp" rev-list --count upstream/<upstream-branch>..fork/<fork-branch>

# Local checkout matches origin
git -C "$plugin_dir" rev-list --count HEAD..origin/<fork-branch>
git -C "$plugin_dir" rev-list --count origin/<fork-branch>..HEAD
```

Final report should include the latest commit and the zero behind/ahead counts.

## Notes

- The human tmux path after only syncing the fork is `prefix + U`; this skill can also update the local checkout directly, which is equivalent for the named plugin when the checkout is clean.
- Do not commit dotfiles for plugin code under `~/.config/tmux/plugins/**`; these are TPM-managed plugin checkouts, not dotfiles source changes.
- Keep this skill personal: it encodes the user's fork naming, TPM layout, and supply-chain policy.
