---
name: cross-review
description: >-
  Gets an adversarial, report-only code review of the current change from a
  different AI model (Claude, Codex or opencode), run headless and read-only,
  and relays the findings. Use when the user asks for a second opinion, a
  cross-model or adversarial review, to "have another model check this",
  red-team a diff, or review working-tree changes, unpushed commits, or a
  branch before committing or opening a PR - especially to pair a review rubric
  skill (e.g. thermo, code-review) with a different model via skl. Not for
  shipping a session to another host (that is agent-teleport / atp), branching
  your own session into a pane (tmux Alt+b), or auto-applying fixes - this
  reports only.
---

# Cross-review

Get a **different model** to attack the current change and report back. You
cannot review your own work adversarially: whether you grade it in-context, via
a Task subagent, or through an `Alt+b` fork, it is the same model reasoning from
the same assumptions, so it rationalises the same mistakes. A fresh process on a
*different* model is the only reviewer that can surprise you.

Report-only by design, and enforced, not just requested: the reviewer runs in a
read-only mode so it *cannot* edit files even if it tries. It finds problems;
you relay them; the user decides what to apply. No autonomous fix loop.

## Procedure

### 1. Pick the reviewer - a model that is not you

Run it **read-only** and **headless**. These exact invocations are load-bearing;
run them as written, not the `cy`/`cxy` aliases (those open a TUI and hang).

| You are | Review with | Command (`$P` = path to the prompt file from step 3) |
|---|---|---|
| Claude | Codex | `codex exec -s read-only --skip-git-repo-check "$(cat "$P")" < /dev/null` |
| Codex | Claude | `claude -p --permission-mode plan < "$P"` |

Why each flag: `-s read-only` sandboxes Codex so writes fail (`--skip-git-repo-check` stops it aborting outside a trusted git dir); `< /dev/null` stops `codex exec` hanging forever waiting on stdin. `--permission-mode plan` is Claude's read-only mode - it may read and run inspection commands but the harness blocks every edit and shell-write; feeding the prompt on stdin avoids the flag parser eating it.

opencode (`opencode run`) is an optional third voice for a panel only, with two caveats stated to the user: it is a *client*, so it does not guarantee a model different from yours unless pointed at one with `--model`, and it has no equivalent read-only enforcement here.

### 2. Resolve the review unit to concrete refs

Pick the narrowest unit that holds the change and hand the reviewer the exact
commands. Resolve the default branch dynamically - **never hard-code `main`**;
this and many repos use `master`:

```sh
BASE=$(git rev-parse --abbrev-ref origin/HEAD 2>/dev/null)   # e.g. origin/master
```

| Unit | Use when | What the reviewer inspects |
|---|---|---|
| Working tree | uncommitted edits (default) | `git status --short`, `git diff HEAD` for tracked changes, **and read any untracked (`??`) files in full** - `git diff HEAD` alone silently omits new files |
| Unpushed commits | commits the upstream lacks | `git diff @{u}...HEAD` (three-dot: only your commits, not upstream-only divergence). No upstream: `git diff "$BASE"...HEAD` |
| Branch vs base | reviewing a whole feature branch | `git diff $(git merge-base HEAD "$BASE")..HEAD` |

If the working-tree unit finds no tracked diff *and* no untracked files, fall
through to the next unit rather than reviewing nothing.

### 3. Assemble the prompt

Write it to a temp file **outside the reviewed repo** (`mktemp`), so a read-only
reviewer never has an artefact to trip over and nothing leaks into the tree;
delete it after. Fill the placeholders:

```text
You are a hostile code reviewer. A different AI wrote the change below; your job
is to find what is wrong with it, not to praise it. Assume it is flawed until
the diff proves otherwise.

Repo: <absolute cwd>
Review exactly this change - run these yourself and read surrounding files for
context. You are read-only; do not attempt to edit anything.
  <the resolved commands from step 2, incl. reading untracked files>

Apply this review rubric:
  <paste the output of `skl inline <rubric-name>` here>
[omit this block entirely if the user named no rubric]

Report findings as a list, most severe first. For each:
- severity: blocker | major | minor | nit
- location: file:line
- problem: one line
- why: the mechanism or the failure it causes
- confidence: Observed (present in the diff) | Inferred (suspected, unverified)
End with one line - VERDICT: ship | fix-first | reject - and the single most
important thing to fix.
Do not invent issues to appear thorough; "no blocking issues found" is a valid
and welcome result.
```

### 4. Run it and relay

A real review reads the rubric, the diff and surrounding files and often
re-verifies claims - it takes minutes, not seconds. Run it with a long timeout
or in the background writing to a file; a default short tool call gets killed
mid-review and wastes the whole run. Capture stdout (redirect to a file for a
large review - the reviewer is read-only, so *you* do the redirect, not it).

`codex exec` wraps the reply in session scaffolding (`provider:` / `hook:` /
`tokens used` lines) - the review is the model's message body; `claude -p`
returns just the final text. Relay the findings as the reviewer wrote them:
preserve every severity and confidence label, never upgrade an `Inferred` into a
fact or drop a `nit`, and do not soften a hostile verdict - the friction is the
point. Then stop. Applying fixes is a separate step the user asks for.

## Rubric composition

The user picks the rubric by loading it alongside this skill (`skl cross-review`
and `skl thermo`). Embed it in the prompt with `skl inline <rubric-name>`, which
prints the full skill bundle - SKILL.md plus its retained files - to stdout: run
it yourself and paste the output into the step-3 prompt. This carries the
rubric's referenced files, which a bare path would drop, and needs no skl or
filesystem access on the reviewer's side. Never paraphrase the rubric; its exact
checks are the point.

## Panel (opt-in)

Only when the user asks for a panel or "more than one opinion": run the same
prompt through two or three different models, then merge - deduplicate
overlapping findings and tag each with which reviewer(s) raised it. A finding
raised by every model is a strong signal; a lone finding still reports, flagged
as single-source.

## Traps

| Tempting move | Why it fails; do this instead |
|---|---|
| Review it yourself / spawn a Task subagent | Same model, same blind spots - not adversarial. Shell out to a different model. |
| `Alt+b`-fork the session to review | A fork inherits this transcript and its assumptions. Use a fresh different-model process. |
| `git diff HEAD` as the whole working-tree review | It omits untracked files, so a change that is all new files reviews as empty. Include untracked files. |
| Trust "Do NOT modify" to keep it read-only | An instruction is not enforcement. Use the read-only invocations in step 1. |
| Let the reviewer fix what it finds | Report-only. Bring findings back; the user decides. |

## Boundaries

Same machine, different model, returns here. To ship a session to *another
host*, use `atp` / agent-teleport. To branch *your own* session into a pane, use
tmux `Alt+b`. This skill spawns a different model to critique and reports back.
