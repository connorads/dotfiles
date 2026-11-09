# The kit

Everything here is loaded before your chart file. Coordinates are sheet pixels on a 520 x 420 card, origin top left.
Points are `[x, y]` arrays; a shape is a list of points.

## Colour and ink

| Name | What it is |
|---|---|
| `INK` | the outline colour |
| `LN` | a soft brown for axes, leaders and small writing |
| `RED` | the one accent: the red pen |
| `PAPER` | the card's paper |
| `TONE` | the shade colour; `mixC(col, TONE, .35)` is a darker tone of a fill for its inner lines |
| `WASH` | named fills: `sage sky blue rose pink gold tan wood stone cream plum moss` |
| `mixC(a, b, t)` | mix two hex colours |
| `shadeOf(c)`, `trim(c)` | a fill's shaded side, and its darker trim |

Every hex you write is softened into the Minicharts palette at build time.

## The pen

| Call | Draws |
|---|---|
| `lid(pts, w = 1.25)` | a closed outline, the usual edge of a shape |
| `rim(pts, w, col, op)` | a closed outline as one plain stroke: use it for inner rims and fine edges |
| `ink(pts, w = 1.25, {col, over})` / `line(pts, {w, col, over})` | an open stroke (a handle, a stem, a string); `over` is how far the pen runs past the ends, `over: 0` for lines that must stop exactly |
| `rule(pairs, col, w, op)` | thin straight lines: `pairs` is a list of `[a, b]` |
| `dash(a, b, col)` / `dashed(a, b)` | a dashed line |
| `stem(a, b, w, col)` | a short straight stroke |
| `spline(pts, closed = true, step)` | a smooth curve through the points (returns points) |
| `bend(a, c, b, n)` | a quadratic curve from a to b pulled toward c (returns points) |
| `smooth(pts)` | an open smooth curve (returns points) |
| `oval(cx, cy, rx, ry)`, `ringAt(fn, n)` | ellipse points |
| `rrect(x, y, w, h, r)` | rounded rectangle points |
| `sector(cx, cy, r0, r1, a0, a1)` | a ring sector in degrees (a pie slice when r0 = 0) |

The pen's wobble is set for you (`LOOSE`); leave it. Outline 1.1-1.25, inner lines 0.5-0.9 and lighter.

## Fills

| Call | Draws |
|---|---|
| `flat(pts, col)` | a flat fill, no edge |
| `wash(pts, col)` | a flat colour fill with the paper wash, no edge. Big areas (a table, a wall, a plate) are fine: the wash is faint |
| `blank(pts)` | paper, to cover what is behind |
| `fill(pts, col, {dx, dy, amp})` | the underlying fill `flat` and `wash` use |
| `clipped(pts, fn)` | draw `fn` only inside `pts` |
| raw SVG | `out.push('<path d="..."/>')`, with `pathOf(pts)` for the path and `n1(v)` to round numbers |

Gradients: write a `<linearGradient>` or `<radialGradient>` into `out` with an id prefixed by your card id, and
fill with `url(#id)`. Keep them soft (light falling on a surface), never glows.

## Isometric solids

Set the origin with `OX = 262; OY = 196;` (or `iso(x, y, fn)`), then `P(x, y, z)` projects a 3D point to the sheet.
`P(x, y, z) = [OX + (x - y) * .866, OY + (x + y) * .5 - z]`, so you can work out where an edge lands before you place labels around it.

| Call | Draws |
|---|---|
| `box(x, y, z, w, d, h, {top, left, ink, marks})` | a box with lit, shaded and top faces (the engine holds two versions; this later one is the one that runs) |
| `block(x, y, z, w, d, h, {wall, deck})` | a building block |
| `cyl(x, y, z, r, h, col)` | an upright cylinder |
| `board(x, y, w, d, h, top, side, r)` | a rounded board to stand things on |
| `gable`, `windowL/R`, `doorL/R`, `flight` | roofs, windows, doors, stairs for buildings |
| `wedge(r, a0, a1, h, top, side, {rim, crimp})` | a thick slice of something round, angles true |
| `cast(x, y, w, d, h)`, `castDisc(x, y, r, h)` then `layShades()` | flat cast shadows |

## Writing

| Call | Writes |
|---|---|
| `TX(x, y, s, {size = 17, anchor, col, cap, rot, cls})` | one line; `cap: true` for small capitals, `cls: 'ser'` for the serif. Text is escaped for you |
| `TXC(x, y, s, o)` | several lines (`\n`), centred on a point |
| `textW(s, size = 17, cap = false)` | how wide a line of writing will be, in sheet pixels: use it to place labels and start leaders right at the text's end |
| `lead(a, b, side)` | a neat leader: open ring at the label end (a), dot on the thing (b); the bend always sits between them. Put `a` on the side of the label that faces the thing (the text's right end, `x + textW(...) + 8`, for a label on the left; its left end for a label on the right), or the line runs back across the text. `side` (1 or -1) is used only when a and b are lined up vertically |
| `title(small, big)` | not used on cards (the card has its own title bar) |

13.5 px is the smallest size. Names in small capitals, values in the hand font, one serif number for the headline.

## Parts, motion and arrows

| Call | Does |
|---|---|
| `PT(note, fn, {lift: [dx, dy], ring, deco})` | a touchable part: on touch it lifts by `lift`, the rest dims, the note shows under the card |
| `STEP(note, fn)` | a touchable step the red pen rings when touched |
| `MOVE(cls, fn, delay)` | gentle looping motion: `steam buzz fall flick sway drift turn` |
| `AR(a, b)`, `HV`, `VH`, `VHV`, `HVH`, `CU(a, c, b)` | red arrows (straight, elbowed, curved) |
| `bead(routes, {dur})` | a dot that walks along arrows you drew |
| `NB`, `PL`, `DM`, `DC` | a box, pill, diamond and circle node with a label (for flow charts) |

## Small things

`potted(x, y, s)`, `leaf(p, ang, L, wd, col)`, `CUP`, `STEAM`, `propCup`, `propJug`, `propPack`, `propSled`,
`propBoard`, `propSeat`, `cat`, `hen`, `duck`, `dog`, `sheep`, `cow`, `tree`, `hive`, `bee`, `fence`, `stones`,
`hay`, `bucket`, `pond`, `reeds`, `plus(x, y, r)` (a sparkle).

## Helpers from the examples

The examples' helpers are loaded too and can be called from your file. The most useful, from `r0` (cards 0-1):
`r0.sol(pts, col, op)` solid, `r0.ln(pts, col, w, op)` plain line, `r0.el(cx, cy, rx, ry)` ellipse points,
`r0.arc(cx, cy, rx, ry, a0, a1)` arc points, `r0.part(pts, col, w)` solid with an edge, `r0.shadow(cx, cy, rx, ry, op)`
a soft ground shadow, `r0.dot(x, y, r, col)`, `r0.lg(id, stops)` / `r0.rg(id, stops)` gradients.
The `r2`, `r3`, `r4`, `r5` families are the same ideas for the other files (`r5loaf`, `r5mug`, `r3cat`, `r3tag`...).
Read them in `assets/examples.js` before you use them.
