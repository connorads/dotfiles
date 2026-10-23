# Running reviewed HyperFrames skills

These skills are vendored locally and use the managed installed HyperFrames CLI.
Run commands in the user's project, never in the read-only installed skill tree.
Use `hyperframes <command> <args...>` without a remote package runner.

The compatibility launcher at `../scripts/plugin-cli.mjs` runs that installed
CLI and disables telemetry, update checks and automatic skill installation.
For a reviewed bundled helper, call the launcher with
`--script <absolute-script-path> <args...>` from the project directory.

Report a missing CLI or helper dependency. Do not fetch a plugin-selected CLI,
bootstrap helper packages or rewrite dependency files without user authorisation.
A plugin version does not freeze external services, registry downloads or project
dependencies. Surface runtime incompatibility before changing them.

Read skill references from this vendored bundle. Report a missing sibling instead
of downloading another release. Skills refresh only through the dotfiles
`update-vendored-skills` review flow. Do not update a plugin during video work.

Write outputs and temporary work inside the project or a run-owned temporary
directory. Pass these ownership and launcher rules to any delegated agent.
