---
name: terminal-fabricate
description: >-
  Authors fake terminal sessions and coding-agent TUIs that render to SVG, PNG,
  or MP4 via termctrl, without running the real program. Use when you need a
  fabricated, idealised terminal image or recording - a mocked-up Claude
  Code / Codex session, or a fake shell / REPL / CLI transcript for a slide,
  doc, README, or blog - instead of capturing a real run. Covers authoring raw
  ANSI stills and hand-built .termctrl timelines. To capture or render a REAL
  running program, use the terminal-control skill instead.
---

# Terminal Fabricate

One idea drives everything: **termctrl already renders terminals to images and
video - you only author its two input formats, and never run the real
program.** The rendering, theming, and encoding are bought (the
`terminal-control` skill / `termctrl` binary owns them). This skill owns only
the *authoring* of a session that never actually happened.

Boundary: to drive or record a **real** program, use the `terminal-control`
skill. This one begins where that ends - when the session is invented, not
captured.

## Two paths, pick by output

| You want | Author | Render with |
|---|---|---|
| A still (SVG / PNG / txt) | a file of raw ANSI | `termctrl save --input` |
| Motion (MP4, replayable) | a `.termctrl` timeline | `termctrl video` / `show --recording` |

### Still from ANSI

Write the screen as ANSI bytes, then render - no session:

```bash
termctrl save --input frame.ansi --cols 80 --rows 24 --format svg --format png --out out
termctrl show --input frame.ansi --cols 80 --rows 24   # visible-text preview
```

`--input -` reads ANSI from stdin. `--cols/--rows` set the geometry for ANSI
input (default 80x24); size them to the content or the screen clips.

### Motion via a .termctrl timeline

Don't hand-encode the format. Author a small steps file and build it with the
bundled script (EXECUTE):

```bash
scripts/build-termctrl.py --in steps.json --out run.termctrl
termctrl video run.termctrl --out run.mp4          # basic export, no edit plan
termctrl show --recording run.termctrl             # final-frame preview
```

`steps.json` (text may contain ANSI; `\e`/`\x1b`/`\033` expand to ESC):

```json
{ "cols": 80, "rows": 24, "steps": [
  { "at_ms": 0,    "text": "\e[1;32m$\e[0m claude \"summarise my day\"\n" },
  { "at_ms": 600,  "text": "\e[2m* Thinking...\e[0m\n" },
  { "at_ms": 1200, "text": "You have 3 meetings today.\n" }
] }
```

For a polished clip with captions/markers/speed, hand off to the
`terminal-control` skill's `record`/`mark`/`video --edit` flow - the timeline
format is identical, so a fabricated `run.termctrl` drops straight in.

## Load-bearing gotchas

- **Line breaks must be CRLF (`\r\n`), not `\n`.** termctrl feeds a real VT
  parser, so a lone `\n` line-feeds without a carriage return and text
  staircases down the screen. `build-termctrl.py` converts `\n` to `\r\n` for
  you; when writing `.ansi` by hand, use `\r\n` explicitly.
- **`.termctrl` bytes are integer arrays**, not strings
  (`{"type":"output","at_ms":600,"bytes":[27,91,...]}`). That is the only
  reason the script exists - never encode them by eye.
- **Always render and look before trusting it.** Save a `txt` (or view the
  `png`) and read it back; a wrong escape or geometry is invisible in the
  source but obvious in the render.

## Faking coding-agent chrome

For a convincing Claude Code / Codex TUI (boxes, spinner, `*` thinking, tool
calls, diffs), read [references/agent-chrome.md](references/agent-chrome.md) -
the highest-fidelity route is to capture the real agent once and edit its ANSI,
with hand-authored building blocks as the fallback.

## Requires

`termctrl` (the `terminal-control` skill's binary; here it is nix-managed via
`packages/terminal-control.nix`). If `command -v termctrl` fails, rebuild
(`drs` on macOS, `hms` on Linux) rather than `cargo install`.
