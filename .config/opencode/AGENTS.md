# AGENTS.md

# Tools

## mise

- Prefer to use [`mise`](https://mise.jdx.dev/walkthrough.html) to manage runtime and tool versions
- If using GHA use `jdx/mise-action@v3` (`mise generate github-action` to create a new one)

## GitHub

Use `gh` CLI to access and update issues and PRs etc. Use `--body-file - <<'EOF'` for multi-line text.
If the user mentions a GitHub issue, remember to close the issue if you fix it - mention "Closes #NO" in commit message.

# Guidance

## Secrets

Do not echo or read secrets. If checking format combine with `| head -c 5` for example to see prefix.

## Assumptions and research

Don't assume, check: It's important to do research to get the latest code and information.

- Web search: Use exa to search the web for current information, documentation, discussions, issues, and solutions.
- Code search: Grep the codebase. You can also clone other repos like libraries from GitHub into /tmp and explore.

Prefer to *use subagents* for research as to not pollute the context with lots of distracting tokens.

## Communication and writing

- Use British English: analyse, favourite, realise, colour etc.
- Be concise: Interactions, PRs and commit messages - be concise and sacrifice grammar for the sake of concision.

## Git

- **MVP commits**: each commit is the smallest complete, coherent change — code + tests + wiring together. Would you send it as a standalone PR? If not, it's too small.
- **Revert test**: could this commit be reverted cleanly, removing exactly one meaningful thing? If reverting orphans code or breaks something unrelated, it's not self-contained.
- **Review test**: can a reviewer understand this commit without reading other commits in the series? If context is missing, fold the pieces together.
- Split when the *concern* changes, not the *file type* — "add feature X with tests" is one commit; "refactor auth then add feature X" is two.
- Renames/moves in a separate commit from content changes (git rename detection breaks otherwise) — but include reference/import updates so the build passes.
- Commit after each coherent unit. Don't batch everything into one mega-commit at the end.
- Plan steps map to commits when they pass the revert and review tests. Multiple small steps may merge into one commit; one large step may split into several.

## Coding and domain modelling

- Strongly typed code: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- Make illegal states unrepresentable Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it
- Quality Abstractions: Consciously constrained, pragmatically parameterised, doggedly documented

## Commits, comments and docs

- Document the *why* and *intent*, the what and how can usually be deduced but the *why* and *intent* will get lost otherwise.
- If you're ever unsure why the user might be doing something then ask - they will appreciate your questioning and clarify.

## Testing

- Write automated tests: Ideally first, in TDD manner. Test expected business behaviour, not implementation. Test through the public API, this helps create good abstractions.
- Do e2e tests: CLI? Run some commands. Web - use a browser (chrome devtools or playwright) to test. Automate a couple e2e tests if advantageous.

## Have you finished?

- Has our change been tested and validated? Also no linting or formatting errors?
- Did we make a big change to functionality or architecture? Consider updating any `.md` file where appropriate and/or writing an ADR
- Did we have any realisations or learnings? Consider updating `AGENTS.md` or `CLAUDE.md`
