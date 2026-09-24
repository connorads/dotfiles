---
name: agent-readiness
description: >-
  Audit a repository for agent readiness: can a coding agent (Claude Code,
  Codex, Cursor) change it and verify its own work without a human. Produces a
  repeatable report with a gated level, a flat score and gaps routed to the
  skills that fix them. Use when asked how agent-ready, AI-ready or
  autonomous-ready a repo is, for a readiness report, level or score, or to
  find what stops agents working unsupervised in a codebase. Not for fixing
  one known gap (use that gap's own skill) or reviewing a diff.
---

# Agent readiness

> **Could an agent change this repo and prove the change works, without
> asking a human?**

Every criterion is a slice of that question. When a case isn't covered by the
table, or a verdict looks wrong, settle it with the question.

Criteria judge outcomes, never tools. A repo is never marked down for
choosing husky over hk, asdf over mise, or Renovate over Dependabot. See the
rule at the top of [references/criteria.md](references/criteria.md).

## Workflow

1. **Probe.** Run `python3 scripts/probe.py <repo> --json` (EXECUTE; Python
   3.10+, stdlib only). It reads tracked files and `git log` and nothing else.
   It never runs project code or touches the network. Each criterion comes back
   `pass`, `fail`, `judge` or `skip` with evidence paths. Exit 2 means the path
   is not a git repo; the message says why. For a bare-repo layout, set
   `GIT_DIR` and `GIT_WORK_TREE` before running it.
2. **Judge the `judge` items only.** Read the files each one cites and answer
   its question. Leave `pass` and `fail` alone unless their evidence is wrong.
   If you override one, say why in `detail`.
3. **Ask before running anything.** Items marked `needs_approval`
   (`unit_tests_runnable`, `devcontainer_runnable`, `interactive_qa_runnable`)
   need commands. Ask the user once, listing the exact commands. Test
   runnability uses the runner's list or collect mode on one file, never the
   whole suite. Never install dependencies, start services or delete files to
   answer a criterion. If the user declines, judge from the docs and say so.
4. **Environment checks are optional and read-only.** `env` criteria need
   forge access (`gh`/`glab`). Without it the probe reports them as
   `skip (environment)`, which is not a repo fault. Run read-only `gh` queries
   only if the user asks for them.
5. **Score and report.** Write your judgements to a scratch JSON file outside
   the repo. Run `python3 scripts/probe.py <repo> --judged <file>` and print the
   report in the template from [references/scoring.md](references/scoring.md).
   Quote the probe's numbers; never compute scores yourself. Upload nothing.
6. **Offer fixes.** List the gaps that block the next gated level, lowest
   level first, each with its route (below). Let the user pick. Change nothing
   before they do.

To keep a baseline, save `--json --judged <file>` output, which records the
judgements too. For a re-run, probe fresh, judge, and pass the saved snapshot
as `--previous <file>`. The diff is mechanical and lists items judged in only
one run apart from real changes. Don't read the old report before judging, or
it anchors the new verdicts.

## Fix routing

Name the owning skill and let it do the work. Don't re-teach its content here.

| Gap | Route |
|---|---|
| `lint_config`, `type_check`, `strict_typing`, `formatter`, `cyclomatic_complexity`, `dead_code_detection`, `naming_consistency`, `code_modularization` | `mechanical-enforcement` skill |
| `pre_commit_hooks` | Extend the repo's existing hook manager if it has one; otherwise the `hk` skill is one route |
| `unit_tests_*`, `integration_tests_exist`, `test_isolation`, `interactive_qa_*` | `testing` skill |
| `test_coverage_thresholds`, `code_quality_metrics` | `test-coverage` skill |
| `deps_pinned`, `min_release_age`, `dependency_update_automation`, `secret_scanning` | `supply-chain-hardening` skill |
| `structured_logging`, `log_scrubbing`, `distributed_tracing` | `logging-best-practices` skill |
| `toolchain_pinned`, `single_command_setup`, `devcontainer` | Keep the repo's tool if it has one; mise or a nix devShell is one route |
| Undocumented decisions found while judging | `adr` skill |
| `agents_md`, `readme`, `build_cmd_doc`, `env_template` and other doc gaps | Write them inline from what the probe and your reading found |

Never game a criterion. A stub test, an empty AGENTS.md, a linter config with
its rules switched off, or a threshold of 0% makes the report pass and the
repo no more ready. If that's the only quick fix, say so and leave it failing.

## Files

- `scripts/probe.py`: the probe. `--criteria-md` regenerates
  `references/criteria.md` from its registry, the single source of truth for
  criteria.
- [references/criteria.md](references/criteria.md): every criterion's outcome,
  level, method and example mechanisms. Read it when a verdict or an item's
  question is unclear.
- [references/scoring.md](references/scoring.md): statuses, the gated level
  and flat score, the `--judged` format and the report template.
  Read it before step 5.
- `tests/`: pytest suite for the probe (`uv run --with pytest pytest tests/ -q`).
- `evals/evals.json`: prompts and assertions for revising this skill.
