---
name: xreview
description: >-
  Gets an adversarial, read-only review of a change or plan from a fresh
  headless agent (by default the other one: Codex when you are Claude, Claude
  when you are Codex) via the `xreview` CLI, then triages every finding against
  the code and reports. Use when the user asks for a second opinion, a
  cross-model or adversarial review, to "have codex/claude check this", to
  red-team a diff, review a PR, review a plan before executing it, or run a
  panel of reviewers, optionally with a review rubric skill via skl. Not for
  applying fixes (report only unless asked), shipping a session to another
  host (agent-teleport), or forking your own session.
disable-model-invocation: true
---

# xreview

Hand the change to a fresh agent process that did not write it, read-only,
and bring its findings back triaged. You cannot review your own work
adversarially. A subagent or a fork shares your model and your transcript, so
it rationalises the same mistakes. `xreview` runs the other agent by default;
naming the same model still helps, because the reviewer does not share your
context.

The CLI does the parts that must not be improvised: target resolution,
untracked files, read-only enforcement per reviewer, a strict JSON schema and
exit codes. Your job is choosing the inputs and triaging the output.

## Procedure

### 1. Choose the inputs

Defaults are right most of the time. Change one only for a reason.

| Flag | Default | Change it when |
|---|---|---|
| `--target` | `auto`: the working tree if dirty, else the branch against `origin/HEAD` | reviewing a commit (`commit:<sha>`), a PR (`pr:<n>`), a branch against a named base (`branch:<base>`), or a plan (`plan:<file>` or `plan:-` for stdin) |
| `--reviewer` | the agent that is not you | the user names one, or asks for a panel (`codex,claude`) |
| `--rubric` | none | the user names a review skill, e.g. `--rubric thermo-nuclear-code-quality-review`. The CLI inlines it with `skl inline`; never paraphrase a rubric yourself |
| `--focus` | none | the user says what worries them ("the retry path") |
| `--model` / `--effort` | pinned per reviewer | the user asks. `--model` is rejected with a panel |

Before a plan review, write the plan to a file or pipe it on stdin. Run from
inside the repository the plan changes, so the reviewer can check the plan's
claims against the code.

### 2. Run it

```sh
xreview --json [flags] > "$out" 2> "$log"
echo "exit=$?"
```

A real review reads surrounding code and often takes several minutes; a panel
waits for its slowest reviewer. Run it in the background or with a long
timeout (10 minutes or more). A short default timeout kills it mid-review and
wastes the run.

| Exit | Meaning | What you do |
|---|---|---|
| 0 | approve | report that, with any low findings |
| 1 | needs-attention | triage (step 3) |
| 2 | usage | read stderr and fix the call. Typical causes: nothing to review, `origin/HEAD` unset (`git remote set-head origin -a`, or pass `--target branch:<base>`), an unknown rubric |
| 3 | every reviewer failed, or `--post` failed | report `errors[]`. Do not present it as a review |

A panel with some failures still exits on its verdict and lists the failures
in `errors[]`. Say which reviewer is missing.

### 3. Triage each finding against the code

The reviewer's findings are claims. For each one, open the cited location and
decide:

- **confirmed**: you reproduced the reasoning from the code
- **disputed**: the code shows it wrong. Say what you saw, with `file:line`
- **needs-you**: it turns on intent, product behaviour or a trade-off only the
  user can settle

Keep the reviewer's severity and confidence verbatim next to your label. Never
upgrade an unverified finding into a fact, drop a low one, or soften a hostile
verdict. A finding tagged by both panel reviewers is a stronger signal; a
single-reviewer finding still reports.

### 4. Report, then stop

Lead with the verdict and the counts (confirmed / disputed / needs-you), then
each finding with location, severity, confidence, reviewer and your triage
note. Do not apply fixes unless the user asks. Fixing is a separate step.

## PR comments

`--target pr:<n> --post` also creates a GitHub review from the findings. It is
created **pending**: nobody else sees it until the user opens the PR and
submits it. Findings on diff lines become inline comments; the rest go in the
review body. Tell the user it is pending and where. GitHub allows one pending
review per user per PR, so `--post` fails (exit 3) if the user already has one.

## Traps

| Tempting move | Why it fails; do this instead |
|---|---|
| Review it yourself, or spawn a subagent | Same model, same blind spots. Run `xreview`. |
| Build the reviewer command by hand (`codex exec ...`, `claude -p --permission-mode plan`) | Plan mode is not read-only headless: the user's allowlist still applies and wrote to the repo in testing. The CLI's flags are the enforcement; see `~/src/xreview/docs/adr/0001-read-only-enforcement-per-reviewer.md` |
| Review only `git diff HEAD` | It omits untracked files. `xreview` includes them; do not narrow the target to work around it |
| Trust "you are read-only" in a prompt | An instruction is not enforcement. The CLI sandboxes each reviewer |
| Relay the JSON as the answer | Findings are claims. Triage them against the code first |
| Paraphrase a rubric into `--focus` | Its exact checks are the point. Pass it with `--rubric` |
| Treat exit 3 as "nothing found" | It means no review happened |

## Boundaries

Same machine, a fresh agent, results back here. To move a session to another
host use agent-teleport (`atp`); to branch your own session, fork the pane.
