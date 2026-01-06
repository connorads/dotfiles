# AGENTS.md

# Tools

## mise

- Prefer to use [`mise`](https://mise.jdx.dev/walkthrough.html) to manage runtime and tool versions
- If using GHA use `jdx/mise-action@v3` (`mise generate github-action` to create a new one)

## GitHub

Use `gh` CLI to access and update issues and PRs etc.

# Guidance

## Assumptions and reasearch

Don't assume, check: It's important to do research to get the latest code and information.

- Web search: Use exa to search the web for current information, documentation, discussions, issues, and solutions.
- Code search: Grep the codebase. You can also clone other repos like libraries from GitHub into /tmp and explore.

Prefer to *use subagents* for research as to not pollute the context with lots of distracting tokens.

## Communication and writing

- Use British English: analyse, favourite, realise, colour etc.
- Be concise: Interactions, PRs and commit messages - be concise and sacrifice grammar for the sake of concision.

## Coding and domain modelling

- Strongly typed code: No `any`, no non-null assertion operator (`!`), no type assertions (`as Type`)
- Make illegal states unrepresentable Model domain with ADTs/discriminated unions; parse inputs at boundaries into typed structures; if state can't exist, code can't mishandle it
- Quality Abstractions: Consciously constrained, pragmatically parameterised, doggedly documented
