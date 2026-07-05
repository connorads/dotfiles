---
name: tmux-plugin-updates
description: Safely review and update sha-pinned tmux plugins. Use whenever the user mentions tmux-upstream, tmux plugin pins or updates, a tmux plugin being commits behind upstream, pin_tmux_plugin in home-shared.nix, asks whether a tmux plugin update is dodgy/compromised/safe, or asks to bump/update a tmux plugin. Default to review-only and ask before bumping unless the user explicitly requested automatic safe updates.
---

# Tmux Plugin Updates

Review upstream commits for sha-pinned tmux plugins, decide whether they are safe, then optionally bump the pin and converge the local checkout.

## How plugins are managed

Plugins point at their upstream repos but are pinned to exact commits by
`pin_tmux_plugin "<name>" "<owner/repo>" "<sha>"` lines in
`~/.config/nix/modules/home-shared.nix`. Home-manager activation converges each
checkout in `~/.config/tmux/plugins/<name>` to its pinned sha (detached HEAD).

The immutable sha is the supply-chain control: upstream authors cannot move a
commit hash the way they can move a branch or tag. `prefix + U` (TPM update) is
inert on detached HEADs — the pin bump is the only update path.

Treat plugin updates like executable supply-chain changes: tmux plugins are shell/Python/Ruby/etc. code that may run inside the user's terminal and tmux server.

## Default policy

- **Review-only by default.** Report safe/hold first and ask before bumping a pin.
- **Auto-bump only when authorised.** If the user explicitly says to update automatically after a clean review, proceed after the review passes.
- **Hold on anything suspicious.** Do not bump if there is instruction/code hijacking, exfiltration, obfuscation, unexplained network calls, or capability creep.
- **Respect dirty local checkouts.** If the local plugin checkout has uncommitted changes, stop and ask.

## Workflow

### 1. Identify stale pins

Run the existing checker first:

```bash
tmux-upstream -v
```

It reads the `pin_tmux_plugin` lines in `home-shared.nix` and compares each
pinned sha against the upstream default branch.

If the user named one plugin, focus on that plugin. Otherwise review every plugin reported as behind.

### 2. Compare in an isolated temp repo

Use a temporary clone so review is independent of the local checkout:

```bash
tmp=$(mktemp -d)
git init -q "$tmp"
git -C "$tmp" remote add upstream https://github.com/<owner>/<plugin>.git
git -C "$tmp" fetch -q --no-tags upstream <upstream-branch>
git -C "$tmp" fetch -q upstream <pinned-sha>

git -C "$tmp" rev-list --count <pinned-sha>..upstream/<upstream-branch>   # behind

git -C "$tmp" log --reverse --date=short \
  --format='%h %ad %an <%ae> %s' \
  <pinned-sha>..upstream/<upstream-branch>

git -C "$tmp" diff --stat <pinned-sha>..upstream/<upstream-branch>
git -C "$tmp" diff --name-status <pinned-sha>..upstream/<upstream-branch>
```

### 3. Review whether the update is dodgy

Read the diff, not just commit titles. Focus hardest on executable surfaces:

```bash
git -C "$tmp" diff --find-renames <pinned-sha>..upstream/<upstream-branch>
```

Quick triage helpers:

```bash
# Non-documentation changes: highest-risk surface
git -C "$tmp" diff --name-status <pinned-sha>..upstream/<upstream-branch> \
  | grep -vE '\.(md|txt|png|jpg|gif|webp|cast)$' || true

# Suspicious added lines; investigate matches in context, don't judge by grep alone
git -C "$tmp" diff --unified=0 <pinned-sha>..upstream/<upstream-branch> \
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

### 4. Check project context

Use GitHub PR/release context where helpful, especially for multi-commit updates:

```bash
gh pr list --repo <owner>/<plugin> --state merged --limit 20
# If commit history mentions PR numbers:
gh pr view <number> --repo <owner>/<plugin> --json title,author,mergedAt,mergedBy,commits,reviews,comments
```

PR approval is supporting evidence only; it does not replace diff review.

### 5. Verify when practical

Prefer lightweight verification proportional to the plugin:

- Run syntax checks for changed scripts when available (`bash -n`, `python -m compileall`, etc.).
- Run bundled tests if they exist and dependencies are already available.
- Do not install new packages or enable install scripts just to test a plugin unless the user approves.

### 6. Report and ask before bumping

Use this structure:

```text
<plugin>: <safe to update | hold>
- upstream: <owner>/<plugin>
- pinned: <sha> (behind by <N>)
- target: <new-sha>
- missing commits: <short summary>
- changed surface: <files/categories>
- review result: <why safe or why held>
- verification: <commands run or not run>

Next: bump the pin? (edit home-shared.nix + rebuild)
```

If the user already authorised auto-update and the review is clean, continue to the bump step instead of asking.

## Bump and converge

Only do this after explicit user approval, or when the original prompt clearly asked to update automatically after a clean review.

### 1. Bump the pin

Edit the plugin's `pin_tmux_plugin` line in
`~/.config/nix/modules/home-shared.nix`: replace the sha with the reviewed
upstream commit (full 40-char sha, not a tag or branch).

### 2. Rebuild to converge the checkout

```bash
drs   # macOS (or hms on Linux)
```

Activation fetches the new sha and detaches the checkout onto it. If offline it
warns and keeps the previous checkout; rerun when online.

### 3. Verify

```bash
git -C ~/.config/tmux/plugins/<plugin> rev-parse HEAD   # must equal the new pin
tmux-upstream                                           # plugin now up to date
```

Reload tmux (`prefix + r` or `tmux source-file ~/.config/tmux/tmux.conf`) and smoke-test the plugin's behaviour.

### 4. Commit the dotfiles change

Commit the `home-shared.nix` pin bump with a message summarising the review
(range, changed surface, review result).

## Notes

- Do not commit plugin code under `~/.config/tmux/plugins/**`; those are nix-managed checkouts, not dotfiles source.
- If a checkout looks wrong (wrong remote, wrong sha), rerun activation (`drs`/`hms`) rather than hand-fixing; `pin_tmux_plugin` converges origin URL and sha.
- Keep this skill personal: it encodes the user's pin layout and supply-chain policy.
