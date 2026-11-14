## 1. Install (on hold)

{{marker}}

raea is not installed on this machine. Do not install it. Do not run the `raea.io` installers (`curl … | sh` or
`irm … | iex`), `raea skills install`, `cargo build`, `cargo install` or `mise use` for raea. If the user asks for raea
work, tell them it is on hold and why.

Why: the hold was set at `v0.1.0-canary.2` (2026-11-05), whose release binaries were built on the maintainer's
machine with no build provenance. From `v0.1.0` (2026-11-09), GitHub Actions builds the release assets and attests
them. Nobody has verified those attestations here yet.

Before you lift the hold:

1. Verify the release tarball: `gh attestation verify <tarball> -R shinyobjectz/raea` must pass.
2. Pin the version in mise as `"github:shinyobjectz/raea" = "<version>"`. Do not use the official installer or
   `raea skills install`. They copy this skill into agent folders and add hooks and MCP servers, outside the reviewed
   catalogue.
3. Run the first render with network access blocked.
4. Remove the `raea-install-hold` and `raea-tripo-cli-hold` skill patches.
