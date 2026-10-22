{{marker}}
On macOS, run every fframes command inside the Nix dev shell:
`nix develop ~/.config/nix#fframes`, or `nix develop ~/.config/nix#fframes -c <command>`.
It provides `cargo-fframes`, x264 and hash-pinned prebuilt FFmpeg and Skia archives. Rust
comes from rustup. Do not install fframes dependencies with Homebrew or `cargo install`.
Build scripts run without network, so a missing prebuilt archive fails the build with its
URL. Stop and report that URL: it must be pinned in `~/.config/nix/packages/fframes-shell.nix`.

Other platforms, from upstream:

```bash
