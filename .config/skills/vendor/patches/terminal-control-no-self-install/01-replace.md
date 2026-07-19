{{marker}}
- If `termctrl` is unavailable, it is nix-managed here (`packages/terminal-control.nix`); do not `cargo install` it (that bypasses the pinned+hashed source). Rebuild to install it (`drs` on macOS, `hms` on Linux), or ask the user which installed binary to use.
