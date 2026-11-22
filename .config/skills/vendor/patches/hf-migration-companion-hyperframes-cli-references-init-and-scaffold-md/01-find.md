<!-- registry-items: allow=blank,landscape-4k,portrait-4k,square-4k,landscape-1440p,portrait-1440p,square-1440p,media-use -->

Scaffolding commands. Use these instead of creating files by hand — they set up the right file structure, copy media, and run transcription.

## init

```bash
npx hyperframes init my-video --skip-skills                      # centered blank (TTY: wizard)
npx hyperframes init my-video --skip-skills --example warm-grain # pick an example
npx hyperframes init my-video --skip-skills --resolution portrait
npx hyperframes init my-video --skip-skills --video clip.mp4     # with video file
npx hyperframes init my-video --skip-skills --audio track.mp3    # with audio file
npx hyperframes init my-video --skip-skills --tailwind           # Tailwind v4 browser runtime
npx hyperframes init my-video --skip-skills --non-interactive    # CI — flag-only, same blank
```

**Default depends on TTY**: in a terminal, the CLI prompts for example/options (default: centered blank). Outside a TTY (CI, agents, piped output) it auto-switches to non-interactive and scaffolds that blank. Pass `--example` only to start from a named example. Pass `--non-interactive` to force flag-only mode on a TTY.

Templates: `blank`, `warm-grain`, `play-mode`, `swiss-grid`, `vignelli`, `decision-tree`, `kinetic-type`, `product-promo`, `nyt-graph`. (The closed set of `hyperframes:example` items in `registry/registry.json` plus the bundled `blank` template. `hyperframes catalog` does not list examples — its `--type` takes only `block` or `component` — so this list has no live equivalent and is checked by `bun run lint:skills`.)

Other useful flags:

- `--resolution` — preset: `landscape` (1920×1080), `portrait` (1080×1920), `landscape-4k`, `portrait-4k`, `square` (1080×1080), `square-4k`, `landscape-1440p` (2560×1440), `portrait-1440p`, `square-1440p`. Aliases: `1080p`, `4k`, `uhd`, `1440p`, `qhd`, `1080p-square`, `4k-square`.
- `--skill=<slug>` — record the owning skill (e.g. `hyperframes`) in `hyperframes.json`, so every later render of this project — re-renders, `npm run render`, `--batch` — is attributed to it on usage telemetry without re-passing the flag. You rarely pass it by hand.
- `--skip-skills` — leave AI coding skills alone: `init` does not install the core set. `HYPERFRAMES_SKIP_SKILLS=1` does the same. Always pass it: without it `init` installs any missing core skill, and installing skills is the person's step. When a core skill is missing, tell the person they can install it with `npx hyperframes skills update`.
- `--skip-transcribe` — don't auto-transcribe `--audio` / `--video` with Whisper.
