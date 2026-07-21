# AGENTS.md

## Tools

- Prefer `mise` for runtime/tool *versions* (not task running). For GitHub Actions, use `jdx/mise-action@v4`; generate new workflows with `mise generate github-action`.
- Use the repo's existing task runner: in a JS/TS project prefer `package.json` scripts (`pnpm <script>`); reach for `mise` `[tasks]` only in polyglot repos or where no native runner fits. Don't shadow scaffolder-seeded scripts with mise tasks.
- Never use `npm` or `npx`; use `pnpm` or `pnpm dlx`. Use `bun` only when the project already does.
- Do not disable package install-script protections globally. If native modules or codegen need install scripts, ask before allow-listing narrowly.
- Use `gh` CLI for GitHub issues and PRs. If you fix a mentioned issue, close it with `Closes #NO` in the commit message.
- For multiline commit/PR text, use stdin flags: `git commit -F - <<'EOF'` and `gh ... --body-file - <<'EOF'`. Never use `$(cat <<'EOF' ... EOF)`.
- If stdin is awkward, use repeated `-m` flags.

## Secrets

Do not echo secrets. If checking format or prefix, use `printenv VAR_NAME | head -c 5`.

Secret paths (`~/.ssh`, `~/.aws`, `~/.config/gh-gate`, ... - the srt `denyRead` list in
`~/.config/srt/base.json`) are deny-ruled for Read/Edit in `~/.claude/settings.json` and
guarded in Bash by the `guard-secret-paths` hook; these hold even under
`--dangerously-skip-permissions`. For a deliberate exception, prefix the command with
`SECRETS_OK=1`. The `secret-path-parity` hk step keeps all surfaces in lock-step with srt.

## Research

Do not rely on memory when the answer can be checked quickly.
Grep the local codebase first for implementation questions.
For external facts, docs, APIs, tools, dependencies, errors, standards, product behaviour, discussions, issues, and solutions, check online.
Grep `~/git/kb/notes/` alongside the web for topics I've researched - my Obsidian vault of compiled notes; `index.md` maps its domains.
For dependency behaviour, inspect installed source such as `node_modules` when present; otherwise clone the repo into `/tmp` and inspect it.
Use subagents for broad research so the main context stays focused.

## Communication

Use British English: analyse, favourite, realise, colour.
Be concise: interactions, PRs and commit messages. Sacrifice grammar for concision.
Use `-`, not em/en dashes (`—`/`–`).
Do not append an unrequested moralizing endcap, caveat, or counterargument to a sharp claim merely to demonstrate balance. If a boundary condition changes the truth of the claim, put it in the mechanism or scope the claim correctly. If it does not, cut it. Accuracy belongs in the argument; model self-protection does not.
Aim for text that is relevant, findable, understandable and usable (ISO 24495-1): lead with the answer or decision, then the reasoning.
One idea per sentence; prefer short, literal, common words, and explain unavoidable jargon inline.
Break procedures into separate ordered steps and keep the critical path short.
Don't assume the reader is holding earlier context - restate what each step needs rather than relying on memory (W3C cognitive-accessibility guidance).

## Git

- Commit on the current branch by default, `main` included; do not branch first unless asked. Push only when asked.
- Make commits as small coherent units: code, tests, and wiring that would make sense as a standalone PR.
- Split by concern, not file type. Keep renames/moves separate from content changes, including import/reference updates so the build still passes.
- A good commit should be revertible without orphaning code or breaking unrelated behaviour, and reviewable without hidden context.
- Commit after each coherent unit rather than batching unrelated work.
- Before amending, check whether the commit was pushed with `git log @{u}.. --oneline`; amend only unpushed commits.
- Never stage with `git add -A`/`--all`/`.` (also denied in settings); they sweep in unintended changes. Stage explicit paths instead.

## Verification

Verify every change before moving on; writing code is not enough.
Run the existing checks first: tests, typecheck, lint/format, hooks (`hk`) or app-specific smoke checks.
If no automated checks exist, still verify manually: run the command, start the app, curl the endpoint, or use browser automation.
Scale verification to risk: config tweak -> smoke test; user-facing feature -> relevant automated suite plus manual confirmation when coverage is thin.
When writing plans, include how each step will be verified.

## Deletion Safety

When recursive deletion with `rm -rf` is blocked, do not bypass the restriction with another permanent-deletion command. If the target is outside `/tmp`, `/private/tmp`, `/var/tmp`, and `$TMPDIR`, move it to Trash with `trash`. For agent-created data inside those temporary directories, leave it for system cleanup and create a fresh directory with `mktemp -d` if needed. Prefer a project's native clean command for generated output.

## Selective Staging

Use `git hunks list` and `git hunks add <id>` to stage specific hunks non-interactively when a file contains changes for multiple concerns.

## Design

Sketch domain types and key workflows before substantial implementation.
For each major design decision, rough out two or more substantially different approaches before committing; the first idea is rarely the best.
Make the change easy, then make the easy change; restructure first if the code fights you.
Follow the conventions already in the file/codebase over personal preference; apply your own defaults only where the repo has none. Change an established convention only with reason, updating every existing use in the same change.
For substantial domains, prefer functional core / imperative shell, explicit ports, and typed values at boundaries.
Keep business decisions pure where practical: gather data, decide, then perform effects.
Model domain states explicitly so illegal states are unrepresentable, not just discouraged.
Name types and functions in the domain's language; keep filler like Manager/Factory/Helper/Util out of the model.
Prefer strong types at boundaries and avoid type-system escape hatches unless the project has a documented reason.
Use explicit error values in domain/application logic; translate exceptions at the shell.
Design system boundaries with observability in mind: structured logs, operation context, and relevant entity/request IDs.
Use the `architecture` skill for domain modelling, ports/adapters, error design, observability, and hard-to-test designs.
For TypeScript specifically - errors-as-values, branded types, domain modules, parse-don't-validate mechanics - use the `typescript` skill (`architecture` stays the language-agnostic spine).

## Enforcement

Rules reviewers would otherwise have to remember should become types, linters, tests, or hooks where practical.
Use `mechanical-enforcement` to choose rules and linters.
Use `hk` to wire git hooks and local checks.

## Intent

Document why and intent when it would otherwise be lost; the what/how should usually be clear from code.
Comments and docs (`AGENTS.md`, `README`, ADRs) are for future readers: describe the standing state, rule or constraint in the present tense, timelessly. Keep change history - "replaced X", "now uses Y", "previously", "no longer" - in commit messages, not the comment or doc body.
If the user's goal or reasoning is unclear, ask before encoding assumptions.
When a decision has trade-offs or rejected alternatives worth preserving, write an ADR or capture it in docs/commit messages.
When something surprises you, capture it before continuing: changed hypothesis, abandoned approach, non-obvious fix, or corrected understanding.
Keep `AGENTS.md`, `CLAUDE.md`, docs, and code comments in sync with reality.

## Self-improvement

Route durable learnings to the strongest home *as you learn them*, not batched to task-end
(cf. `## Intent`): mechanically checkable -> `## Enforcement`; a decision's *why* -> `## Intent`;
external research -> KB vault (`~/git/kb/notes/`).

The part those don't cover: a durable **domain** rule / gotcha / framing belongs in the
**catalogue skill that owns it** (`architecture`, `testing`, `typescript`,
`mechanical-enforcement`, ...) - these exist to accrete curated detail - and a reusable
procedure no skill owns (e.g. reverse-engineering a new binary type) is a new-skill candidate
via `writing-skills`. Don't derail the task: capture the candidate, then *propose* the skill
edit with its diff; auto-apply only a trivial verified fact (spot-check any command/flag
live). New skills and trigger/description changes are always suggest-only.

## Testing

Prefer TDD for behavioural changes: see the failure, make it pass, then refactor.
Test observable behaviour through public APIs, not implementation details.
Prefer pure unit tests for pure logic, contract/integration tests at boundaries, and minimal e2e for critical journeys.
Avoid mocks by default; use fakes, real values, or real infrastructure at adapter boundaries where practical.
Verify every change proportionally before committing.

Use the `testing` skill for test strategy, TDD, refactoring tests, and test design.
Use the `test-coverage` skill for coverage audits, thresholds, and CI/hook enforcement.
