# Motion graphics and type

Pieces drawn from scratch: cards, type, stats, logos and end cards, moved on the frame. The files under `motion/` and
`craft/` are copies of raea's craft guides (`raea guide NAME` prints the same text); [motion.md](motion.md) is the
overview with the core rules every composition keeps, so read it first.

## Which file to open

| You are... | Open |
|---|---|
| starting a file: its size, its compositions, one piece in several shapes | [motion/compositions.md](motion/compositions.md) |
| cards, stacks, type sizes, fonts, a headline over footage | [motion/layout.md](motion/layout.md) |
| entrances, exits, counters, push-ins: anything that moves | [motion/animating.md](motion/animating.md) |
| colours, faces and sizes from the brand kit (every piece needs it) | [motion/brand.md](motion/brand.md) |
| media files, logos, imports, `staticFile` | [motion/assets.md](motion/assets.md) |
| when things happen and for how long | [motion/timing.md](motion/timing.md) |
| type that reads badly, a layout that's crowded, motion that's dead or busy | [craft/verbs/typeset.md](craft/verbs/typeset.md), [craft/verbs/layout.md](craft/verbs/layout.md), [craft/verbs/animate.md](craft/verbs/animate.md) |

## The verbs

- `raea brand DOMAIN` (HEADLESS) writes the kit from the brand's site: brand/brand.css, brand.json, BRAND.md and the
  logos. Run it first when the brief names a brand.
- `raea part list`, `raea part add NAME` (HEADLESS) copy a ready part into components/, yours to change.
- `raea render EDIT.tsx --at A,B -o frames/` for stills to look at; `--alpha` for transparent PNGs to overlay in
  another editor.

## Checks

`raea check --quick` after each save; [motion/rendering.md](motion/rendering.md) for the full check and the quality an
export of type needs (`--quality master`).
