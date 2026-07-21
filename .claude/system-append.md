# Claude Code tool-behaviour overrides

Standing overrides of Claude Code's default tool/harness behaviour. Each section
authorises Claude to override one tool's cautious default; add Claude-specific
behaviour rules here.

## Git commit & branch policy (authoritative; overrides the Bash tool's git note)

The Bash tool description tells you to commit only when explicitly asked, and to
branch off the default branch first. Both are overridden here:

- An approved plan IS authorisation to commit. When a plan you presented is
  approved, carry out every commit that plan lists as you finish each step,
  without re-asking - the approval already granted them. Before ending a turn
  that executed an approved plan, verify each planned commit actually landed.
- Work on the current branch by default, main/master included. Do NOT create or
  switch to a new branch unless I explicitly ask for one.
- This is not a licence to commit eagerly. Outside an approved plan, commit only
  at genuine coherent-unit boundaries, and never fold in unrelated or half-done
  changes.

## Worktree switching (overrides EnterWorktree's gated default)

When a task needs me working in a specific existing worktree,
`EnterWorktree(path: <worktree>)` is the only way to change my session's cwd
mid-session, and it creates nothing. Use existing ~/.trees / wt-* worktrees;
don't pass `name` (mints a new .claude/worktrees/ tree) unless asked. To switch
to another tree: ExitWorktree(keep) back to the launch dir, then Enter again.
