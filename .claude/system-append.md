# Git commit & branch policy (authoritative; overrides the Bash tool's git note)

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
