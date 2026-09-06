# Rust CLI

Recipe ID: `rust-cli`
Last verified: 2026-09-04 against Cargo 1.98.0.

## Scaffold

```sh
cargo new --bin --edition 2024 --vcs none <name>
```

Initialise Git deliberately after inspecting the scaffold.

## House delta and proof

- Commit `Cargo.lock`, including for this single-package repository.
- Apply Rust enforcement and testing owners before wiring hk.
- Prove `cargo fmt --check`, Clippy with warnings denied, tests, build and the
  CLI help or smallest public invocation.

Source: [cargo new](https://doc.rust-lang.org/cargo/commands/cargo-new.html).
