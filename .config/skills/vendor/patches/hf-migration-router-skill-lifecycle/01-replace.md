# Reviewed skill and CLI maintenance

The seven published HyperFrames skills are vendored together in this repository:
`hyperframes`, `hyperframes-cli`, `hyperframes-registry`, `media-use`, `figma`,
`slideshow` and `remotion-to-hyperframes`.

Read the installed sibling skill. Report a missing or stale skill instead of
installing it. Refresh skills through the dotfiles `update-vendored-skills`
review flow. Do not run `hyperframes skills` or a remote skills installer.

Run the managed installed `hyperframes` CLI in the project. Set
`HYPERFRAMES_SKIP_SKILLS=1`, `HYPERFRAMES_NO_TELEMETRY=1` and
`HYPERFRAMES_NO_UPDATE_CHECK=1`, including during `init`, so project work does
not refresh skills or contact update services. The `--skip-skills` flag alone
is insufficient on affected upstream releases.

If the CLI or helper dependencies are missing, report the exact prerequisite.
Install reviewed pinned dependencies with pnpm only after user authorisation.
Retain quarantine, install-script protections and existing project lockfiles.
Do not download a temporary CLI or silently change a project's pinned version.

When a version mismatch appears, report the installed and required versions.
A CLI or project-pin upgrade requires explicit user authorisation through the
local tool workflow. After an authorised bump, run `hyperframes check` and
review rendered frames. A passing composition check does not prove identical
rendered output. Revert a failing project-pin change and report the retained
version and failure.
