# hk version-routing evals

Run each prompt in a fresh session with the old skill and with the candidate.
Provide the stated repository facts to both sessions. Ask for concrete edits
without executing them. Read the full response, then validate the proposed Pkl
and behaviour in disposable repositories. Keep transcripts outside the skill.

## New v2 setup

> set up hk for this pnpm TypeScript repo. hk 2.0.1 is installed, prettier and
> eslint are dev dependencies, and package.json already has a typecheck script.
> I want the same checks in check, fix and pre-commit. Show the minimal hk.pkl,
> mise tools and hook wiring. Keep the existing package scripts.

Pass criteria:

- Uses matching v2 schema URLs and top-level shared steps.
- Does not require standalone Pkl or seed mise tasks for the package scripts.
- Uses tracked wrappers with quiet mode and preserves failure summaries.
- Explains manual fix leaves changes unstaged and pre-commit stages fixes.
- Validates the configuration and inspects the intended hook plan.

## Maintain pinned v1

> this repo is pinned to hk 1.56.1, and both schema URLs are 1.56.1. It has
> explicit check, fix and pre-commit hooks. Add JSON formatting with our existing
> prettier dependency. Please show the exact edits. I'm not asking for an upgrade.

Pass criteria:

- Preserves the tool pin, URLs, explicit hooks and their existing settings.
- Adds JSON to an existing Prettier glob or adds a compatible step to the
  existing shared mapping. Does not add JSON to ESLint's input.
- Does not use v2 top-level steps or v2-only builtin options.
- Includes a JSON-only validation/fix scenario without expanding unrelated hooks.

## Requested migration with staging and history scanning

> migrate hk 1.56.1 to 2.0.1. Our explicit hook mapping has a custom fix hook
> that relies on automatic staging, and a secret check using
> `gitleaks detect --no-banner --redact --log-level=error` to scan history.
> Keep those behaviours and hook memberships. List the edits and checks.

Pass criteria:

- Updates the runtime selection and both URLs together, retaining explicit hooks.
- Adds hook `stage = true` to preserve the custom fix hook's index changes.
- Preserves the history-scan command, not a working-tree or staged-scan substitute.
- Does not suggest `hk migrate pre-commit` as a v1 upgrade command.
- Checks removed interfaces only where present, then validates and compares plans.
- Tests staging and preservation of unstaged edits in a disposable repository.

The baseline on 2026-09-20 added standalone Pkl for a v2 setup and omitted the
hook staging setting during migration. Those two outputs must change. The v1
maintenance case is a regression guard because the baseline preserved its pin.
