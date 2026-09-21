# Next.js integration checks

Use the official [Next.js guide](https://varlock.dev/integrations/nextjs/) and
installed package source for the versions in the target repository.

## Development startup

Observed on 2026-09-16 with Next.js 16.2.9, Varlock 1.19.0 and
`@varlock/nextjs-integration` 1.2.2: a missing required `AUTH_SECRET` makes native
`next dev` report an error, print `Ready` and leave requests hanging. A validation
preflight before starting Next makes the package command exit with status 1.

For a development-only script, the preflight is:

```sh
varlock load --agent --env development && next dev
```

Package scripts supply the local binary on PATH. If the command also supports
`NODE_ENV=test`, select `test` in that case and `development` otherwise, matching
the integration. Validate before launching any concurrent emulator or watcher.
Test missing and malformed inputs in an isolated fixture where other sources
cannot supply them. Assert non-zero exit and no child startup, then test valid
startup separately.

The native integration selects the environment. Do not copy the generic skill's
`APP_ENV` / `@currentEnv` example over it without checking the installed loader.
`@currentEnv` takes priority over the CLI's `--env` selection.

Verified with Varlock 1.19.0: `varlock load --agent --env development` is valid;
`varlock run --env development -- <cmd>` is not. Check each subcommand's help
before transferring flags between commands.

## Builds and credential rotation

In the same spike, synthetic secrets are absent from public `.next/static`
files but present in `.next/server` Turbopack runtime chunks. An isolated probe
of the installed runtime shows embedded build configuration can overwrite
credentials supplied at startup. These findings apply to the tested versions;
verify newer versions independently.

Before approving a deployment path:

1. Build with synthetic credential A. Inspect public assets, source maps and
   server artefacts separately without printing real secret values.
2. Start that same artefact with synthetic credential B using the actual
   deployment entry point. Verify which value the application uses.
3. Check captured logs and public responses for the synthetic values. Check
   invalid production configuration prevents startup.

Ordinary `next start`, standalone output and hosted deployments have different
entry paths. A passing local `next start` check does not establish standalone or
Vercel behaviour. Encryption of embedded configuration does not establish runtime
precedence or credential rotation. Treat server artefacts as containing secrets
until the target build demonstrates otherwise.

## Preserve existing configuration semantics

Match requiredness and coercion to the app's predicates. A string flag enabled
only by literal `"true"` changes behaviour if a boolean parser also accepts `1`
or `yes`. A non-empty emulator-host default enables any existing host-presence
branch. Test those inputs before declaring an environment migration equivalent.
