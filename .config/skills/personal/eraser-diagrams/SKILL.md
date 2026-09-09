---
name: eraser-diagrams
description: >-
  Authors Eraser diagram JSON and renders it to PNG or HTML with the local
  `eraser` wrapper: places every node by hand (there is no auto-layout), looks
  up icon names, then reads the rendered image to correct the geometry. Use
  when the user wants an Eraser diagram, or a polished raster diagram to put in
  front of a customer, a deck or a board - "draw an architecture diagram",
  "make me a diagram for the deck", "render this as a PNG". For C4 modelling,
  or Mermaid / PlantUML / D2 output, use the c4-diagrams skill instead.
---

# Eraser Diagrams

Eraser's one unusual decision: **there is no auto-layout.** `x` and `y` are
required on every entity, and the renderer only routes the connections between
where you put things. A Mermaid habit produces a heap of overlapping boxes here,
and nothing reports it, because **the rendered image is the only feedback
channel** - the CLI cannot emit measured geometry, so bad layout exits 0.
**Use the `eraser` wrapper, never bare `eraser-diagrams`**: the wrapper disables
config discovery (the config file is an ES module the CLI imports, so it runs as
you) and pins Chromium.

## The `eraser` CLI

```bash
eraser registry                        # every tag, its kind and required props
eraser schema <tag>                    # the JSON Schema of one tag - read this before guessing a prop
eraser icons [--refresh] [pattern]     # icon names; pattern is an unanchored, case-insensitive regex
eraser validate d.json                 # schema check, no browser, ~fast
eraser render d.json -o d.png          # PNG (default); -f html, --scale 2 for retina
eraser render d.json --json            # machine-readable report on stdout
```

Exit codes: `0` ok · `1` an input failed · `2` the invocation failed (bad flag,
no Chromium). Status lines and issues go to **stderr**, so a bare `eraser
render` looks silent when piped.

## The loop

Three commands, and the third is looking at the picture.

1. Write the JSON.
2. `eraser validate d.json` - catches unknown tags, missing `x`/`y`, wrong prop
   types. Cheap, no browser.
3. `eraser render d.json -o d.png`.
4. **Read `d.png`.** Overlaps, collisions and stray coordinates appear nowhere
   else.
5. Fix the numbers, repeat from 2.

Never skip step 4. There is no measured-geometry output from the CLI (`--format`
takes `png|html` only), so a diagram that validates and renders can still be
unreadable.

## The document form

```json
{
  "entities": [
    { "tag": "Shape", "id": "api", "x": 15, "y": 15, "width": 240, "height": 60,
      "texts": [{ "text": "HTTP API" }] },
    { "tag": "Icon", "id": "db", "x": 375, "y": 20, "icon": "postgres",
      "texts": [{ "text": "Postgres" }] }
  ],
  "connections": [
    { "from": "api", "to": "db", "label": "SQL" }
  ]
}
```

- `entities` and `connections` are **both** required. One without the other is
  `E_ENVELOPE`; `"connections": []` is the point.
- Every entity needs a `tag` (`E_MISSING_TAG` otherwise). A connection with no
  tag is a `Relationship`, so `{ "from": "a", "to": "b" }` is complete.
- 14 tags. Entities: `Shape` `Icon` `Activity` `Event` `Gateway` `Textbox`
  `Group` `Lane` `Pool` `Divider` `DatabaseTable` `Legend`. Connections:
  `Relationship` `DatabaseRelationship`.

## You own the layout

Top-left origin, `x`/`y` non-negative, in pixels. `width`/`height` are
*minimums* the content grows past. Numbers that produce a readable first draft:

- First node at `15,15`.
- Column pitch 140-240 px, row pitch 70-115 px.
- `Shape` 100-240 wide, 45-105 tall. `Icon` renders 50 px square at the default
  `md` (`sm` 32, `lg` 72, `xl` 100) and ignores `width`/`height`.
- `Event` and `Gateway` (BPMN) are 56 px.
- Children of a `Group`/`Lane`/`Pool` sit 20-30 px inside it, and name the
  container with `containerId`. The container's own `x`/`y`/`width`/`height`
  are absolute, not relative to its children.

The rendered canvas is the content bounding box plus a 16 px margin, so its
dimensions are a free sanity check: `file d.png` reporting something far wider
than you drew means a stray coordinate.

## Icons

`eraser icons <pattern>` lists the catalogue (3,856 names, cached 30 days).
Look the name up; **do not guess**. An unknown name is not an error - it renders
a placeholder glyph and warns `W_UNKNOWN_ICON`, so a typo is silently ugly
rather than loud. `eraser render --unknown-icon error` makes it fatal when that
is what you want.

## Gotchas

- **Bad layout is silent.** Two overlapping boxes plus one node at `x: 10000`
  produced zero errors and zero warnings: `validate` ok, `render` ok.
- **One stray coordinate wrecks the canvas.** That same diagram rendered
  10137x102 instead of the 472x92 the laid-out version gives, because the canvas
  is derived from the content bounding box. A typo in one `x` yields a ribbon of
  empty space, reported as success.
- **Labelled branches need more room than the default row pitch.** Two labelled
  connections leaving one `Gateway` 105 px apart stacked their labels on top of
  each other at the fork, again with no warning. 160 px separated them.
- **An unknown property is a warning, not an error.** `text` instead of `texts`,
  or `label` on a `Group` instead of `title`, renders an unlabelled box and
  exits 0. `eraser schema <tag>` before inventing a prop name; `--fail-on-warning`
  turns the whole class fatal.
- **Body text is `texts: [{ "text": "..." }]`**, an array of runs, on `Shape`
  and `Icon` alike. A `Group` titles itself with `title: { "text": "..." }`; a
  connection labels itself with a plain string `label`.

## Raw fallback (no `eraser` on PATH)

Only when the wrapper is unavailable. Both flags matter: `--no-config` because
config discovery walks up to `/` and imports whatever it finds, `CHROMIUM_PATH`
because auto-detection otherwise picks the daily Google Chrome.

```bash
CHROMIUM_PATH=/path/to/chromium eraser-diagrams render --no-config d.json -o d.png
```

`--no-config` goes *after* the subcommand: inputs starting with `-` are passed
after `--`, so appending it makes it a positional input file.

## Not this skill (use instead)

- **`c4-diagrams`** owns C4 modelling (System Context, Container, Component)
  and Structurizr / Mermaid / PlantUML / D2 output. Reach for it when the
  question is *what to draw*; this skill is *how to draw it in Eraser*.
- **Mermaid** stays right for anything that must be correct rather than
  beautiful, and for anything going into an artifact, where it renders natively
  and stays diffable. Eraser earns its cost when the output is a raster image
  going in front of a customer or a board.
