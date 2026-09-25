# Engine and scenes

`assets/engine.html` is copied into each project as `src/engine.html`;
`film.py build` inlines `src/style.js` and `src/scenes.js` into it, plus every
image, font, the soundtrack and the timeline, into one HTML file.

## Contents

- Scene contract
- Anchoring beats
- Helpers
- Transitions
- Recipes for common beats
- Canvas traps
- Performance

## Scene contract

```js
const CAPTIONS = new Set(["n01", "n05"]); // line ids that get an on-screen caption
const POSTER = 1.6;                        // frame shown before play
const SCENES = [
  { id: "title", a: 0, b: 2.35, tr: null, draw(t) { /* ... */ } },
  { id: "habitat", a: 2.15, b: 6.15, tr: "slide", draw(t) { /* ... */ } },
];
```

- `a`/`b` are seconds. Consecutive scenes overlap by 0.1-0.3s; the later
  scene's `tr` (`"slide"` torn paper from the right, `"drop"` from above,
  `"cut"`) runs across the overlap. Both scenes draw during it, each into its
  own offscreen canvas through the global `ctx`.
- `draw(t)` must depend only on `t`. Use `rnd(seed)` (deterministic), never
  `Math.random()` or `Date`.
- Captions: caption only lines with no on-screen words already saying them.
  A caption repeating a ransom title on screen is clutter.
- Scene length: 2-6s. Change something on screen at least every 1-2s; a
  contact sheet exposes any stretch where nothing moves.

## Anchoring beats

`word(id, w)` returns the start of the first word in line `id` beginning with
`w` (case and punctuation ignored); `clip(id).start`, `lineEnd(id)`. Put gags
on those: the coin lands at `word("c02", "bail")`, the choir and reveal at
`word("n05", "cake")`, a stamp at `word("d04", "booked") - .05`. The same refs
work in `film.json` for SFX (`"c02:bail"`), so sound and picture share one
anchor. Scene boundaries can stay numeric; beats inside them should not.

## Helpers

Engine (always available): `clamp lerp inv rnd jit pop popOut Ez.{in,out,io,back}`,
`sticker(name, x, y, w, {rot, alpha, sx, sy, ax, ay, flip, t, seed})`,
`head(name, x, y, h, {t, expr, talk, idle, rot, seed})`,
`label(text, x, y, size, {font, color, rot, alpha, sc})`,
`bubble(x, y, w, h, tailX, tailY, lines, t, t0, {t1, size, font, fill})`,
`wobblePath(points, t, seed)`, `word`, `clip`, `lineEnd`, `env`.

- Pass `t` and a distinct `seed` to every sticker so the 12fps boil jitter
  differs per object; identical seeds move in lockstep and look mechanical.
- `head(..., {talk: false})` for anyone not speaking in that scene; force
  `expr: "talk"` for cheering or awe, `expr: "shock"` for reactions.
- Entrance: `y + (1 - pop(t, t0)) * 600` slides in with overshoot; stagger a
  row by 0.07-0.1s per item.
- Bubble text: one idea, max two short lines, 44-66px. `lines` can be a
  function of `t` to change text mid-line ("Sorry chaps..." then "50/50
  chance / I might bail.").

Style helpers come from `src/style.js`; the style reference lists them.

## Transitions

Slides for most changes, drop for a new "place" (a display case, night), cut
on a stamp or a record scratch (the hard cut is the joke). Keep the overlap
short (0.1-0.25s) so the old scene is not left on screen mid-line.

## Recipes for common beats

Freeze frame on a record scratch: render the scene at `Math.min(t, FZ)`, then
drain the colour and bring the speaker in over it.

```js
const FZ = word("c02", "sorry") - .45, tf = Math.min(t, FZ);
drawCelebration(tf);             // your scene's pre-scratch content, frozen
if (t > FZ) { drainColour(); head("alex", 1360, 640, 720, { t, seed: 1 }); }
```

Coin flip that lands on a word:

```js
const f0 = word("c02", "50/50"), f1 = word("c02", "bail") + .02, k = clamp((t - f0) / (f1 - f0));
const x = lerp(1000, 640, k), y = lerp(1000, 660, k) - Math.sin(k * Math.PI) * 420;
const phase = k < 1 ? k * Math.PI * 13 : Math.PI;   // cos(phase) < 0 shows the losing face
coin(x, y, 130, phase, t, ["STAY", "BAIL"]);        // style-collage.js
```

Someone "removed" from the group: yank their head off-screen with
`Ez.in` over 0.5s from the word, switch to their shock face 0.2s before, and
strike a running tally (old number crossed out, new one pops in).

Countdown by calendar: draw the grid once, then `ring()` a date on the word
that proposes it and `cross()` it on the word that kills it.

## Canvas traps

- Two overlapping holes cut with an even-odd fill leave the overlap filled
  (a binocular mask went dark in the middle). Punch holes on an offscreen
  canvas with `destination-out`.
- `multiply` blending is ink on light paper and invisible on dark overlays;
  switch to `source-over` there (a stamp vanished on the end card).
- Drawing helpers inside a translated or scaled group take local
  coordinates; passing absolute ones applies the offset twice (marks landed
  off-canvas).
- Text that fits at one length overflows at another; `ransom()` shrinks to
  `maxW`, other text needs a width check on the longest string.

## Performance

`baked()` renders each sticker's shadow once at load instead of calling
`shadowBlur` for every sticker on every frame. Live playback measured 60fps in a
1280x720 window and about 20fps in a headless 1920x1080 page; export is
frame-exact regardless, so judge motion from the MP4, not the live page.
