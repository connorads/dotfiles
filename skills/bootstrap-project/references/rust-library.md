# Rust library

Recipe ID: `rust-library`
Last verified: 2026-09-04 against Cargo 1.98.0.

## Scaffold

```sh
cargo new --lib --edition 2024 --vcs none <name>
```

Initialise Git deliberately after inspecting the scaffold.

## House delta and proof

- Commit `Cargo.lock` as house policy for reproducible development and CI.
- Apply Rust enforcement and testing owners before wiring hk.
- Prove `cargo fmt --check`, Clippy with warnings denied, tests, build and a
  public library example or doctest.

Source: [cargo new](https://doc.rust-lang.org/cargo/commands/cargo-new.html).
