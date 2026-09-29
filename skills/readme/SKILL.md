---
name: readme
description: >-
  Writes, rewrites and reviews a project's README.md so it is short, visual
  and reads as written by a person: one picture, a one-sentence pitch, the
  first command near the top, and reference detail moved into docs. Use when
  creating a README for a repo, CLI, library or package, making an existing
  README shorter or better looking, reviewing one for AI slop, or setting up a
  GitHub, npm or PyPI landing page. Not for AGENTS.md, ADRs or API reference
  docs; use living-documentation for those.
---

# README

A README is the front door, not the house. Every choice follows from one
question:

> **What does a stranger need on the first screen to decide to try this, and
> where do they go next?**

Anything that doesn't answer it moves to a docs page or another markdown file,
and the README links to it.

## Pick the type

| Type | When | Length |
|---|---|---|
| Signpost | A docs site already exists | Under 250 words |
| Pitch and go (default) | Everything else | 300 to 800 words |
| Manual | Never write this by choice | - |

A README that needs a table of contents has become a manual. Split it.

## The shape

Write the first screen in this order:

1. **Picture.** Logo, art, screenshot, terminal capture or chart. Centred.
2. **Name and one sentence.** Say what it is in plain words: "An extremely
   fast Python package and project manager, written in Rust." Not a slogan.
3. **Proof.** One thing that shows the claim. It is often the picture itself.
4. **First command** within about 100 words of the top: the install line or
   the smallest working example.

Then, below the first screen:

5. **Why**, if the problem isn't obvious. Two or three sentences about the
   problem, not the product.
6. **Features** as short bullets, only if they add to the proof.
7. **Links out**: docs, contributing, licence. One line each.

Skeleton:

````markdown
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/hero-dark.png">
    <img alt="<what the image shows>" src="docs/hero-light.png" width="600">
  </picture>
</p>

# name

One sentence that says what it is.

```sh
install-or-run-command
```

## Why

The problem, in two or three sentences.

## Docs

- [Usage](docs/usage.md)
- [Configuration](docs/config.md)
````

Use the `<picture>` dark and light pair only when both images exist. One image
is fine.

## The picture

Every README gets one. Pick by what the project is:

| Project | Picture |
|---|---|
| CLI or TUI | Terminal screenshot or GIF of a real run (vhs, asciinema) |
| App or UI component | Screenshot |
| Performance claim | Benchmark bar chart |
| Framework whose product is a layout | Commented directory tree in a code block |
| Library | The smallest code sample, placed first |

Never invent an image path. If no asset exists, add
`<!-- TODO: screenshot of <exact command or screen> -->` where it belongs and
tell the user what to capture.

Badges are not a picture. Keep at most 4, and only live ones: CI status,
version, licence, downloads. Drop static badges such as "TypeScript" or
"deps 0", which report nothing and link nowhere.

## Progressive disclosure

Move detail out, and link to it:

| Content | Where it goes |
|---|---|
| Full flag or option table | `--help` output, or `docs/usage.md` |
| Output schema, config reference | `docs/<topic>.md` |
| Internals, security model, design rationale | `docs/` or an ADR |
| Dev setup, tests, layout | `CONTRIBUTING.md` |
| Per-platform install variants | `<details>` blocks in the README |

When a docs file already exists, link to it rather than repeating it. When
it doesn't, create it with the moved content and say so in the handback.

## The words

- Write the plainest true sentence. Name the mechanism or the number, not the
  feeling.
- One idea per sentence. Sentence-case headings.
- No bold or italics for emphasis in running text. Bold is fine as a list
  lead-in that ends in a full stop and is followed by new detail.
- No decorative emoji, including in tables.
- No machine-specific paths such as `~/src/...` or `~/.config/...`. Write the
  command a stranger would run.

After drafting, reread every sentence against the table below. Each row is a
shape that marks text as machine-written. The "before" quotes are from real
READMEs and baseline runs.

| Shape | Before | After |
|---|---|---|
| Denial then reframe | "Not a vector index. No embeddings, no vector store: a real graph you traverse." | "It builds a graph of your code and answers by following its edges." |
| Aphorism close | "A finding is a claim, not a fact." | "Check each finding against the code before acting on it." |
| Mirrored antithesis | "pick per moment, not per tool." | "Every action works from the keyboard and the mouse." |
| Staccato negation | "No Figma. No generic rounded boxes. No 30-minute sessions." | Say what it does instead. |
| Triplet then punchline | "Same diagnosis. Same fix. The only thing that died was the throat-clearing." | State the result once. |
| The reveal | "That's it. You get three files:" | "This writes three files:" |
| Dash-list tagline | "A second opinion - read-only, headless, one JSON answer." | One plain sentence with a verb. |
| Identical bullets | Every bullet a bold phrase, an em dash, then an explanation | Vary them, or use plain phrases |
| Em dash aside | A clause set off by a pair of em dashes (U+2014) | Two sentences, or commas |

If a sentence survives only because it sounds good, cut it.

## Before handing back

- Word count fits the type.
- A picture is present, or a TODO names exactly what to capture.
- The first command appears within about 100 words.
- Reference tables and schemas live outside the README.
- No row from the shapes table remains.
- No local paths, static badges or decorative emoji.

Annotated openings from READMEs that do this well, for when a worked example
would help: [references/examples.md](references/examples.md).

`evals/` holds this skill's test prompts and assertions; it is not loaded
during normal use.
