## Set up (on hold)

{{marker}}

raea is not installed on this machine. Do not install it. Do not run the `raea.io` installer, `cargo build`,
`cargo install` or `mise use` for raea. If the user asks for raea work, tell them it is on hold and why.

Why: the release binaries (reviewed at `v0.1.0-canary.2`, 2026-11-05) are built on the maintainer's machine, not in
CI. They have ad-hoc code signatures, no notarisation and no build provenance attestation. The published SHA-256 only
proves that the download equals the upload. Static checks found nothing malicious, but nothing ties the binary to the
public source.

Before you lift the hold:

1. Confirm that GitHub Actions builds the release assets and attests them:
   `gh attestation verify <tarball> -R shinyobjectz/raea` must pass.
2. Pin the version in mise as `"github:shinyobjectz/raea" = "<version>"`. Do not use the official installer. It
   copies skills into `~/.claude/skills`, outside the reviewed catalogue.
3. Run the first render with network access blocked.
4. Remove the `raea-install-hold` and `raea-bevy-install-hold` skill patches.
