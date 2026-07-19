# Faking coding-agent chrome

Read this when the fabricated session must look like a real coding-agent TUI
(Claude Code, Codex, Grok) rather than a plain shell.

## Highest fidelity: capture once, then edit

Guessing an agent's exact palette, box-drawing, and spacing is where fabricated
TUIs look fake - and those details drift with every release, so any table here
would rot. Don't guess when you can copy. Use the `terminal-control` skill to
capture the real agent's bytes once, then edit that ANSI into the session you
want:

```bash
termctrl save --format ansi --out real -- claude   # or codex, etc.
# edit real.ansi: keep the chrome, swap the words, then render as a still,
# or slice it into steps.json lines for a .termctrl timeline.
```

The captured ANSI carries the authentic colours and glyphs; you only rewrite
the content between them. This is strictly higher fidelity than the building
blocks below - prefer it whenever the agent is installed.

## Fallback building blocks (illustrative, verify against a real capture)

When you cannot capture the real agent, hand-author from these. Treat the
specific colours as a starting point, not canon - confirm against a real
screenshot and adjust. Escapes are shown as `\e`.

- **Prompt line**: `\e[1;32m$\e[0m command args`
- **Thinking / spinner line**: `\e[2m* Thinking...\e[0m` (dim). Real clients
  animate a braille/dot spinner glyph; for a still, one frame reads fine.
- **Tool call marker**: a leading glyph + dim label, e.g.
  `\e[36m> Read\e[0m path/to/file` - a coloured bullet then the tool name.
- **Diff**: `\e[32m+ added line\e[0m` / `\e[31m- removed line\e[0m` over a
  dim `@@` hunk header.
- **Boxed panel**: Unicode box-drawing (`+`-style corners in ASCII, or real
  `┌ ─ ┐` box chars) around a padded block; keep the width inside
  `--cols`.

## Sizing

Agent TUIs are wide. Set `--cols`/`rows` (still) or the recording header
`cols`/`rows` (motion) to match - Claude Code screenshots read well around
`--cols 100 --rows 30`. Too narrow and boxes wrap and break the illusion.
