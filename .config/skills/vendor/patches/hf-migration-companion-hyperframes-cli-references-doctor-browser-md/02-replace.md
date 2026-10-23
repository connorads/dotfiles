
- **Missing FFmpeg** — install via `brew install ffmpeg` (macOS) or your package manager, or [configure existing binaries](#configure-ffmpeg-without-a-package-manager).
- **Missing bundled Chrome** — run `hyperframes browser ensure`.
- **Low memory** — close other Chromes, reduce `--workers`, or use `--quality draft`.
- **Chrome exits instantly inside an agent sandbox (macOS)** — seatbelt-style sandboxes
