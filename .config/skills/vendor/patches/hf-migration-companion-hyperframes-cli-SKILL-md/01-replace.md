---

<!-- LOCAL PATCH (connorads dotfiles): reviewed vendoring, managed tools and explicit reporting consent. -->

Use the managed installed CLI and provision missing tools through the local tool workflow. Do not bootstrap executables, install or refresh skills, or upgrade packages during video work. Preserve telemetry opt-outs. Feedback, catalogue-gap reports, ratings, host-app reports and public reproduction uploads require an explicit user request for each report. Publishing or uploading project content requires explicit user authorisation. Never run harness usage probes or add telemetry-only provider tags.

# HyperFrames CLI

Run `hyperframes <command>` unless the project gives a wrapper; then use the wrapper. It needs Node.js 22+ and FFmpeg. Every command has `--help`; most take `--json`, and a failure prints `✗ …`, a `Fix:` line and exits non-zero.

## Commands by job
