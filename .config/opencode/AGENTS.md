# AGENTS.md

# Tools

## mise

- Prefer to use [`mise`](https://mise.jdx.dev/walkthrough.html) to manage runtime and tool versions
- If using GHA use `jdx/mise-action@v3` (`mise generate github-action` to create a new one)

## GitHub

Use `gh` CLI to access and update issues and PRs etc. Use heredoc for updating posting text to PRs.
If the user mentions a GitHub issue, remember to close the issue if you fix it.

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

- Atomic commits: one logical change per commit — if the message needs "and", split it
- Renames/moves always in a separate commit from content changes (preserves blame/history)
- Separate refactors from features/fixes when non-trivial; tiny incidental cleanups can ride along
- Each commit should ideally build and pass tests; enforce on main, best effort on WIP branches

## Coding and domain modelling

- Strongly typed code: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- Make illegal states unrepresentable Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it
- Quality Abstractions: Consciously constrained, pragmatically parameterised, doggedly documented

## Testing

- Write automated tests: Ideally first, in TDD manner. Test expected business behaviour, not implementation. Test through the public API, this helps create good abstractions.
- Do e2e tests: CLI? Run some commands. Web - use a browser (chrome devtools or playwright) to test. Automate a couple e2e tests if advantageous.

## Have you finished?

- Has our change been tested and validated? Also no linting or formatting errors?
- Did we make a big change to functionality or architecture? Consider updating any `.md` file where appropriate and/or writing an ADR
- Did we have any realisations or learnings? Consider updating `AGENTS.md` or `CLAUDE.md`
