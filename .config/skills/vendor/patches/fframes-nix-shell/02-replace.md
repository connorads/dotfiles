```bash
nix develop ~/.config/nix#fframes -c cargo fframes new my-video --format landscape --fps 30 --yes
```

A cargo-fframes 1.2.0 project resolves `fframes-media` 1.3.0 and fails with `mismatched types`
between two `usvgr` versions. Downgrade both crates, macro first, before the first build:

```bash
cd my-video && cargo generate-lockfile
cargo update -p fframes-media-dir-macro --precise 1.2.0
cargo update -p fframes-media --precise 1.2.0
```
