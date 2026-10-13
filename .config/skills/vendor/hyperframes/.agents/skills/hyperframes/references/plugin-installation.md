# Running the local vendored skills

Use the installed `hyperframes` executable on PATH from the user's project directory. The local Node launcher at `hyperframes/scripts/plugin-cli.mjs` also dispatches that executable. It suppresses automatic skill installation and CLI update checks. It does not download tools, read plugin manifests, or select a plugin release.

If the CLI is missing, report the prerequisite. Provision tools through the local reviewed tool workflow. Resolve companion skills from this vendored bucket. Do not download missing skills or refresh them during video work.

For bundled Node helpers, the launcher accepts `--script <absolute-script-path> <args...>`. Helpers resolve installed project dependencies. Missing dependencies require reviewed pinned versions installed with pnpm and local quarantine and install-script protections. A skill revision does not freeze provider services or registry assets.

Treat the vendor directory as read-only during video work. Put outputs in the project or a temporary directory. Refresh skills through the update-vendored-skills workflow.
