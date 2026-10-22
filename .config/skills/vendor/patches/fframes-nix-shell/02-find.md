```bash
curl -fsSL https://raw.githubusercontent.com/dmtrKovalenko/fframes/main/scripts/new-video.sh | bash -s -- my-video --yes
# or install the generator once and use it directly:
cargo install --locked cargo-fframes
cargo fframes new my-video --format landscape --fps 30 --yes
```
