Update `cargo-fframes` before scaffolding each new video so it uses the latest published template.

```bash
curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fframes/main/scripts/new-video.sh | FFRAMES_REINSTALL=1 bash -s -- my-video --yes
```

Or use Cargo directly.

```bash
cargo install --locked cargo-fframes &&
  cargo fframes new my-video --format landscape --fps 30 --yes
```
