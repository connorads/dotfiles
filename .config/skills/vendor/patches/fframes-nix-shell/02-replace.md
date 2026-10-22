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

Then let direnv load the shell, so plain `cargo` works in the project directory, with or
without the build-script sandbox. nix-direnv keeps the shell's store paths from garbage
collection, including the x264 library the binary links to:

```bash
echo 'use flake ~/.config/nix#fframes' > .envrc && direnv allow
```
