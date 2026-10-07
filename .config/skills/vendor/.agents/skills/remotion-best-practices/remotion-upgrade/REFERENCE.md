---
name: remotion-upgrade
description: Upgrade Remotion, and related packages
version: 4.0.532
---

# Upgrade Remotion

1. Inspect the project manifests and lockfile to identify the package manager and workspaces. Preserve unrelated changes.
2. Determine whether `@remotion/cli` is locally available. If it is, run:

   ```bash
   pnpm exec remotion upgrade
   ```

   Check whether this CLI version refreshes project-local skills. If it does, use the manual package upgrade below instead; skill refreshes use the recorded-revision review workflow.

3. If `@remotion/cli` is not available, upgrade manually:
   - Get the latest stable Remotion version with `npm view remotion version`.
   - Find every installed `remotion` and `@remotion/*` dependency across the project and upgrade them all to that exact version. Preserve their dependency sections and the project's workspace or catalog conventions.
   - Read the `@remotion/studio` dependencies for the target Remotion version using `npm view @remotion/studio@<version> dependencies --json`. Align installed auxiliary packages such as `zod`, `mediabunny`, and `@huggingface/transformers` with the versions listed there. Use the `mediabunny` version for installed `@mediabunny/*` packages.
   - Run the project's package manager to update its lockfile.
4. <!-- LOCAL PATCH (connorads dotfiles): skill refreshes require recorded Git snapshots and instruction review, including during runtime upgrades -->
   Refresh installed Remotion skills only through the separate recorded-revision preview and review workflow. Package upgrades do not authorise replacing reviewed skill instructions.

5. Review the manifest and lockfile diff. Ensure all Remotion packages use one version and installed auxiliary packages use their recommended versions. If the CLI is available, run `pnpm exec remotion versions` as an additional check.

The [Remotion releases](https://github.com/remotion-dev/remotion/releases) contain the changelog and may be useful for summarizing relevant changes after the upgrade.
