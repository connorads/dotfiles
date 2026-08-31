# AGENTS.md

## Tools

- Prefer `mise` for runtime/tool *versions*, not task running. GitHub Actions: `jdx/mise-action@v4`; scaffold with `mise generate github-action`.
- Use the repo's existing task runner: JS/TS -> `package.json` scripts (`pnpm <script>`); `mise` `[tasks]` only in polyglot repos or where no native runner fits. Don't shadow scaffolder-seeded scripts with mise tasks.
- Never `npm`/`npx`; use `pnpm`/`pnpm dlx`. `bun` only when the project already does.
- Do not disable package install-script protections globally; ask before allow-listing narrowly for native modules or codegen (`supply-chain-hardening` skill).
- Use `gh` for GitHub issues and PRs. If you fix a mentioned issue, close it with `Closes #NO` in the commit message.
- Multiline commit/PR text via stdin: `git commit -F - <<'EOF'`, `gh ... --body-file - <<'EOF'`. Never `$(cat <<'EOF' ... EOF)`. If stdin is awkward, repeat `-m`.

## Browser automation

- Close disposable Playwright sessions before finishing: `playwright-cli -s=<name> close`; `close-all` only when every open session is disposable (it also kills other agents' sessions).

## Secrets

Do not echo secrets. If checking format or prefix, use `printenv VAR_NAME | head -c 5`.

Do not read or write secret paths (`~/.ssh`, `~/.aws`, `~/.config/gh-gate`, ... - the srt
`denyRead` list in `~/.config/srt/base.json`); the deny rules and the Bash guard hold even
under `--dangerously-skip-permissions`. For a deliberate exception, prefix the command with
`SECRETS_OK=1`.

## Research

Do not rely on memory when the answer can be checked quickly.
Grep the local codebase first for implementation questions.
When actual behaviour or state is the question, observe the running system - telemetry, logs, live config, state - rather than inferring from code.
Check online for external facts: docs, APIs, tools, dependencies, errors, standards, product behaviour, discussions, issues, solutions.
Grep `~/git/kb/notes/` alongside the web - my Obsidian vault of compiled notes; `index.md` maps its domains.
For dependency behaviour, read installed source such as `node_modules`; if absent, clone the repo into `/tmp`.
Use subagents for broad research so the main context stays focused.

## Communication

Use British English: analyse, favourite, realise, colour.
Be concise: interactions, PRs and commit messages. Sacrifice grammar for concision.
Use `-`, not em/en dashes (`—`/`–`), and don't swap in parentheses or a mid-sentence colon instead. If a thought needs separating, end the sentence.
If a sentence can't be restated as a concrete instruction, fact, or number, cut it. Name the mechanism, not the feeling.
Cut a bold label plus colon that restates its own line (`**Performance:** Performance improved...`); a bold lead-in ending in a period followed by genuinely new detail is fine.
Do not append an unrequested moralising endcap, caveat or counterargument to a sharp claim for balance. A boundary condition that changes the claim's truth goes into the mechanism or scopes the claim; otherwise cut it. Accuracy belongs in the argument; model self-protection does not.
Lead with the answer or decision, then the reasoning.
One idea per sentence; prefer short, literal, common words, and explain unavoidable jargon inline.
Break procedures into separate ordered steps and keep the critical path short.
Restate what each step needs; don't assume the reader is holding earlier context.

## Git

- Commit on the current branch by default, `main` included; do not branch first unless asked. Push only when asked.
- Never merge a PR; stop at "PR open, checks green" and hand back. An approved plan is not merge authorisation - "land", "ship" or "release" names the goal, not permission to press merge. `gh pr merge` and `gh stack merge` are ask-ruled in settings, so the prompt is the authorisation. `gh stack merge` lands every unmerged PR below its target at once.
- Commit after each coherent unit - code, tests and wiring that would stand as a PR - rather than batching unrelated work.
- Dependent work that would otherwise be one big PR goes in a stack: `gh stack` (GitHub stacked PRs). Read the `gh-stack` skill first (`skl preview gh-stack`) - most commands open a TUI under a PTY and hang.
- Show intended atomic commit boundaries in implementation plans; revise them when the work reveals a better split.
- Split by concern, not file type. Keep renames/moves separate from content changes, including import/reference updates so the build still passes.
- A good commit is revertible without orphaning code or breaking unrelated behaviour, and reviewable without hidden context.
- Before amending, check whether the commit was pushed with `git log @{u}.. --oneline`; amend only unpushed commits.
- Never stage with `git add -A`/`--all`/`.`; they sweep in unintended changes. Stage explicit paths, or stage hunks non-interactively with `git hunks list` then `git hunks add <id>` when one file holds changes for several concerns.

## Verification

Verify every change before moving on; writing code is not enough.
Run the existing checks first: tests, typecheck, lint/format, hooks (`hk`) or app-specific smoke checks.
If no automated checks exist, still verify manually: run the command, start the app, curl the endpoint, or use browser automation.
Scale verification to risk: config tweak -> smoke test; user-facing feature -> relevant automated suite plus manual confirmation when coverage is thin.
When validating a hypothesis (mine, a ticket's, a report's), isolate the claim it stands or falls on and run the cheapest observation that discriminates it from the rival explanation; evidence consistent with every explanation verifies nothing.
When writing plans, include how each step will be verified.

## Deletion Safety

When `rm -rf` is blocked, do not route around it with another permanent-deletion command. Outside `/tmp`, `/private/tmp`, `/var/tmp` and `$TMPDIR`, move the target to Trash with `trash`. Inside those, leave agent-created data for system cleanup and `mktemp -d` a fresh directory if needed. For generated output, prefer the project's native clean command.

## Design

Sketch domain types, workflows and ports before substantial implementation.
Follow the conventions already in the file and repo over personal preference; apply your own defaults only where the repo has none. Change an established convention only with reason, updating every use in the same change.
Fork two or more substantially different approaches for a major or hard-to-reverse decision before committing (`design-forking` skill); the first idea is rarely the best.
Use the `architecture` skill for domain modelling, ports/adapters, error design, conventions, observability, and hard-to-test designs; the `typescript` skill for the TypeScript specifics (errors-as-values, branded types, domain modules, parse-don't-validate) - `architecture` stays the language-agnostic spine.

## Compatibility

Whether external callers exist is the user's call, not the agent's: a change's exposed surface is visible in the code, its consumers are not. Deployed, published, or still present is not evidence of a consumer.
Default to changing the thing outright and updating every caller in the repo; deleting the old path beats deprecating it.
When a change alters a surface others could call - exported API, CLI flags, config schema, HTTP route, stored data shape, published package - ask before adding or skipping compatibility. Do not decide it silently either way.
Where compatibility is agreed, use expand-migrate-contract with a named deletion condition (`refactoring` skill), and note the decision in the commit message.
Never add an unrequested shim, legacy flag, or silent fallback.

## Enforcement

Rules reviewers would otherwise have to remember should become types, linters, tests, or hooks where practical.
Use `mechanical-enforcement` to choose rules and linters, `hk` to wire git hooks and local checks.

## Intent

Document why when it would otherwise be lost; the what/how should usually be clear from code.
Comments and docs (`AGENTS.md`, `README`, ADRs) describe the standing state, rule or constraint in timeless present tense. Change history - "replaced X", "now uses Y", "previously", "no longer" - belongs in commit messages, not the comment or doc body.
If the user's goal or reasoning is unclear, ask before encoding assumptions.
When a decision has trade-offs or rejected alternatives worth preserving, write an ADR (the `adr` skill) or capture it in docs/commit messages. Supersede a changed record with a new one; never edit it into a changelog of itself.
When something surprises you, capture it before continuing: changed hypothesis, abandoned approach, non-obvious fix, or corrected understanding.
Keep `AGENTS.md`, `CLAUDE.md`, docs, and code comments in sync with reality.

## Self-improvement

Route durable learnings to their strongest home *as you learn them*, not batched to task-end:
mechanically checkable -> `## Enforcement`; a decision's *why* -> `## Intent`; external research
-> KB vault (`~/git/kb/notes/`); a durable **domain** rule, gotcha or framing -> the catalogue
skill that owns it (`architecture`, `testing`, `typescript`, `mechanical-enforcement`, ...);
a reusable procedure no skill owns -> a new-skill candidate via `writing-skills`.
Don't derail the task: capture the candidate, then *propose* the skill edit with its diff.
Auto-apply only a trivial verified fact (spot-check the command/flag live). New skills and
trigger/description changes are always suggest-only.

## Testing

Prefer TDD for behavioural changes: see the failure, make it pass, then refactor. Test observable behaviour through public APIs, not internals; avoid mocks by default.
Read the `testing` skill for the mechanics - layer choice, fakes, characterisation, flaky tests; `test-coverage` for coverage, thresholds and CI/hook enforcement.
