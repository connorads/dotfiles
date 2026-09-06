---
name: bootstrap-project
description: >-
  Bootstrap or harden a project into a verified repository with official
  scaffolders and house conventions. Use for a new app, service, library or
  CLI; requests to scaffold, spin up or start a repo; and requests to bring an
  existing repository up to house standard. Also use in advisory mode when the
  user asks for a bootstrap plan or prompt. Do not use for feature work,
  deployment-only work, architecture selection before a stack is chosen, or an
  isolated lint, test or hook change in an established project.
---

# Bootstrap Project

Produce evidence for a green repository, not a tree of plausible config.
Official scaffolders own their generated trees. This skill owns the sequence,
house deltas and proof that each gate performs its claimed job.

## Select the mode

- **Greenfield** creates a repository from an empty directory.
- **Retrofit** inspects an existing repository and fills proven gaps. Preserve
  working package managers, hooks and runners unless replacement is in scope.
- **Advisory** returns research, a plan or a prompt. It does not mutate a
  project.

In greenfield mode, ask only for unresolved choices that are hard to reverse:
recipe, name and location, remote visibility, deployment, and permission for
development commands that create external resources. Do not repeat facts in
the request. A requested GitHub remote uses the authenticated account unless
the user names another owner; do not ask or flag the owner as open. CI is
absent unless requested; do not ask or flag it as open. If product or
architecture choices still determine the recipe, stay advisory until they
settle.

## Route the recipe

Read exactly one recipe before invoking its scaffolder.

| Intent | Recipe |
|---|---|
| TanStack Start on Cloudflare Workers | [references/cloudflare-tanstack-start.md](references/cloudflare-tanstack-start.md) |
| Static Astro on Cloudflare Workers | [references/cloudflare-astro-static.md](references/cloudflare-astro-static.md) |
| Foldkit, minimal Effect Worker and Alchemy | [references/cloudflare-foldkit-alchemy.md](references/cloudflare-foldkit-alchemy.md) |
| Vite React TypeScript SPA | [references/vite-react-ts.md](references/vite-react-ts.md) |
| Python application | [references/python-app.md](references/python-app.md) |
| Python library | [references/python-library.md](references/python-library.md) |
| Rust CLI | [references/rust-cli.md](references/rust-cli.md) |
| Rust library | [references/rust-library.md](references/rust-library.md) |
| TypeScript CLI | [references/typescript-cli.md](references/typescript-cli.md) |
| TypeScript library | [references/typescript-library.md](references/typescript-library.md) |

A recipe is platform wiring, not product architecture. Stop before choosing
databases, authentication, domain modules, RPC surfaces or application
features. Route those decisions to `architecture` and the language skill.

## Compose the owner skills

This skill orders work. Other skills own the policy:

| Concern | Owner |
|---|---|
| Linter choice, strict compiler settings and mechanical rules | `mechanical-enforcement` |
| hk configuration, hook installation and the pnpm lifecycle checker | `hk` |
| Dependency build-script approvals | `supply-chain-hardening` |
| Test strategy and the project verification skill | `testing` and `test-coverage` |
| TypeScript design after scaffolding | `typescript` |
| Deployment and production smoke checks | The target platform's deployment skill |

Read the applicable owner skill before changing its layer. Copy hk's canonical
`assets/pnpm-build-scripts-check.mjs`; do not recreate its policy here.

## Greenfield sequence

### 1. Preselect the toolchain

Check live `--help` and primary documentation for the chosen scaffolder.
Resolve tools before scaffolding with ephemeral `mise exec` versions, so the
official output stays pristine. Use numeric major or major-minor selectors in
the later repository `mise.toml`; never use `latest` or `lts`.

Use pnpm, never npm or npx, for a new JavaScript project. Record the resolved
pnpm patch in `package.json#packageManager`. Commit the ecosystem lockfile for
applications and libraries.

### 2. Scaffold and inspect

Run the recipe's exact official command. Decline Git, remote and deployment
offers. Inspect files and package metadata instead of trusting a success
banner. Initialise Git only when the directory is not inside another work
tree.

Commit the untouched scaffold. Stage explicit paths, never `git add -A`.

### 3. Add the repository toolchain

Write repository-local mise configuration without shadowing native scripts or
commands. JavaScript uses package scripts, Python uses uv and Rust uses Cargo.
Use `mise generate github-action` only when CI is requested, then adapt the
result to `jdx/mise-action@v4` and the native checks.

Commit the toolchain separately.

### 4. Harden

Apply the owner skills. Keep generated configuration unless it conflicts with
a house invariant. Explain a replacement in the commit message.

For pnpm, review every inherited `allowBuilds` decision with
`supply-chain-hardening`. A warm local install is not evidence that a cold CI
or platform install succeeds. Never fix the mismatch by setting
`ignoreScripts: false`.

Commit hardening before testing the commit hook. hk's Git stash can otherwise
hide the dependencies and configuration the hook needs.

### 5. Prove the gates

Run native typecheck, lint, test and build commands. Start servers on
`127.0.0.1`. Run both the normal commit path and `hk check --all`.

Execute `scripts/check-project.sh --root <repo> --recipe <id>` from this skill.
The checker is read-only. Exit 0 means the stable repository contract is
present; it does not replace native checks.

For the negative hook probe:

1. Confirm the hardening commit already exists. Stop and commit it if not.
2. Record `HEAD`.
3. Add one deliberate, identifiable violation.
4. Run `git commit` alone on its line, redirecting stderr to a temporary file.
5. On the next line assign `commit_status=$?`. Do not pipe the commit, append
   `&&` or `;`, or use `echo $?` as the capture mechanism.
6. Require a non-zero captured status and require the temporary stderr file to
   name the deliberate violation. Stdout or a generic hook failure does not
   count.
7. Prove `HEAD` did not advance, then remove only the sentinel change.

### 6. Seed project guidance

Create `AGENTS.md` from [assets/AGENTS-template.md](assets/AGENTS-template.md)
using only commands just proved. Create an actual `CLAUDE.md -> AGENTS.md`
symlink. Add `.agents/skills/verify/SKILL.md` with the project's exact native
checks and risk-scaled smoke tests.

Commit guidance separately.

### 7. Add remotes, CI or deployment only when requested

Creating a remote, publishing and deploying are distinct external mutations.
Use `gh` for GitHub work. Deployment output proves resources changed, not that
the service works. Require the recipe's public route or health smoke before
calling a deployment successful. A failed smoke means the deployment failed,
even when every infrastructure command was green.

Alchemy development is a separate authority boundary. Resources without local
implementations may create real cloud infrastructure, including state storage.
Do not run `alchemy dev` under a local-only request.

## Retrofit sequence

Observe the repository's actual runners, hook path and cold-install behaviour.
Use the closest recipe's stable assertions to locate gaps, then apply only
those gaps in greenfield order. The checker describes the full greenfield
contract; do not use its hk failures to replace or layer hk beside a working
hook manager. Apply owner skills only after observation shows their layer is
missing or broken. Do not run a scaffolder. Keep each coherent change and its
verification in a separate commit.

## Maintain the recipes

`scripts/check-scaffolders.sh` is an opt-in maintainer harness. It uses the
network and executes third-party package code in isolated temporary
directories. It never deploys or runs `alchemy dev`. Read its `--help` before
execution. `tests/check-project.bats` and `tests/check-scaffolders.bats` own the
two script contracts.

When a user reports a bootstrap-process failure or observed output contradicts
a recipe, add the failure to
[evals/evals.json](evals/evals.json) before changing the instruction. Re-run
the command, update the recipe's dated verification line and cite a primary
source. Keep raw transcripts and generated repositories outside the skill.
