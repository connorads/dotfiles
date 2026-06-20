# ==============================================================================
# biokc — Touch ID-gated keychain helper (desktop only)
# ==============================================================================
#
# Tiny Swift CLI (see ../biokc/main.swift) that stores a secret in the login
# keychain and releases it only after a successful Touch ID. gh-gate uses it to
# gate the GitHub App private key behind a fingerprint instead of the keychain
# password.
#
# Built here, not vendored as a binary or pulled from nixpkgs: biometric keychain
# access needs the macOS Security/LocalAuthentication frameworks + the Swift
# toolchain. We compile the committed source with the SYSTEM /usr/bin/swiftc
# (Command Line Tools) inside a nix derivation — nix orchestrates and pins the
# result into the read-only, root-owned store, but ships no Swift of its own.
# Relies on `sandbox = false` (set in nix.conf) so the builder can reach
# /usr/bin/swiftc and the SDK.
#
# Desktop-only: requires Touch ID hardware and the CLT (swiftc). The headless
# server has neither, so it never imports this. gh-gate grant only runs on the
# machine holding the key (this desktop) anyway.
#
# Security model (full rationale in the gh-gate header):
#   - Item ACL auto-pins to this binary's code identity -> only biokc reads it
#     silently; every other process hits the password prompt.
#   - Biometrics enforced in-process; on macOS 26 task_for_pid is denied to
#     unprivileged same-user code, so the gate resists injection.
#   - Store path is root-owned + read-only (r-xr-xr-x), so a non-root attacker
#     can't trojan the binary. gh-gate invokes it by absolute path.
#
# Re-key note: changing main.swift changes the store path -> new code identity ->
# the keychain ACL no longer matches, so re-import the key (`gh-gate setup`).
{ pkgs, ... }:
let
  biokc = pkgs.runCommandLocal "biokc" { } ''
    mkdir -p $out/bin
    export SDKROOT="$(/usr/bin/xcrun --show-sdk-path 2>/dev/null || echo /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk)"
    /usr/bin/swiftc -O -o $out/bin/biokc ${../biokc/main.swift} \
      -framework LocalAuthentication -framework Security
    # Hardened runtime: belt-and-braces, strips get-task-allow.
    /usr/bin/codesign -s - -o runtime -f $out/bin/biokc
  '';
in
{
  environment.systemPackages = [ biokc ];
}
