# Style: collage

Hand-drawn British storybook collage: watercolour-and-ink caricature stickers
with white scissored borders on aged paper, ransom-note lettering, rubber
stamps, marker circles and crosses, paper-tape captions, everything
"boiling" at 12fps. Suits affectionate comedy about real people (a group
chat, a team, a family) and mock documentaries. Built for a 61s film about
friends failing to arrange a curry; every device below shipped in it.

Code: `assets/style-collage.js` (copied to `src/style.js` by `film.py init`).

## Contents

- Look
- Assets to generate
- Helpers in style-collage.js
- Comic devices that worked
- Pacing
- Frame

## Look

- **Palette:** cream paper `#efe4cc`, ink `#1f1a16`, stamp red `#d62d20`,
  mustard `#e9b634`, teal `#2f6f73`, blush `#f2c9b8`. Scene moods come from
  multiply tints over the same paper: maroon `#5b2a3c` for a reverent reveal,
  navy `#1c2a4a` (plus a second multiply of `#3a4d7a`) for night, rose
  `#c9546a` at 0.75 for romance, slate `#7d8aa0` at 0.9 for gloom, orange
  `#f4b860` at 0.55 for the finale.
- **Fonts** (`film.py fonts`): Permanent Marker (labels, tallies), Patrick
  Hand (speech bubbles), Caveat 700 (asides like "a.k.a.", "(tomorrow)"),
  Special Elite (captions, brass plaques, typewriter stamps), Alfa Slab One,
  Bungee and Abril Fatface (ransom letters, stamps).
- **Texture:** the engine adds overlay grain and a warm vignette on every
  frame; every sticker jitters about 1px and 0.7° on the 12fps grid.

## Assets to generate

Characters and variants per [characters.md](characters.md), using that
file's style paragraph (it is this style's). Then, with the first character
as style reference:

| Asset | Prompt core | Notes |
|---|---|---|
| `bg_paper` | flat full-bleed warm cream sketchbook paper, subtle fibres, faint tea stains, soft vignette, faint pencil guide marks, no objects, no text, 16:9 | used by `paperBG()` behind most scenes |
| habitat background | cut-paper collage landscape of the subject's "habitat" as a nature-documentary set: layered torn-paper hills of local landmarks, lush exaggerated foreground foliage, no text, 16:9 | pan it slowly; generate 1.4x wide if panning |
| display case | empty antique natural-history specimen case, dark wooden frame, faded olive baize, front view, no text, 16:9 | heads pinned in it like specimens |
| hedge / foliage strip | long strip of leafy hedge and grasses, cut paper, 21:9 sticker | characters peek up from behind it |
| props | one sticker per gag object: dish, drinks, moon in a nightcap, candelabra, sad rain cloud, a shopfront with its sign text verbatim | all "cut-out paper sticker with white border, transparent, no text" |

Draw in code rather than generating: calendars, clocks, coins, tallies,
speech bubbles, confetti, rain, sunburst rays, stars. They must change with
the story (dates circled, hands at 8pm, coin faces), and code keeps the text
exact.

## Helpers in style-collage.js

- `ransom(str, cx, cy, size, t, t0, {seed, stagger, times, maxW})`: title and
  keyword lettering; `times: [word(...), ...]` pops each word as it is spoken.
- `stamp(text, x, y, size, t, t0, {color, rot, font, blend})`: slams in from
  2.4x; distressed. The punchline device.
- `ring(...)`, `cross(...)`, `strokePts(...)`: marker write-ons.
- `paperBG(t, tint, alpha)`, `doodles(t, seed)`, `rays(...)`, `confetti(...)`,
  `sparkle(...)`, `heart(...)`, `rain(...)`.
- `binoculars(t, amount)`: nature-documentary viewer mask.
- `drainColour()`: freeze-frame desaturate for a record scratch.
- `coin(x, y, r, phase, t, faces)`: a spinning two-faced coin.
- `drawCaption(...)`: narrator words on a strip of paper tape, lighting up as
  spoken.
- `STYLE`: sets the engine's default label and bubble fonts.

## Comic devices that worked

- **Mock nature documentary frame.** A grave narrator treats a friend group
  as a rare species: binocular reveal of heads peeking from a hedge, heads
  pinned in a specimen case with brass plaques of mock-Latin names, the
  group's nicknames stamped over them one by one as the narrator says each.
- **The sacred object reveal.** Dim the stage, spotlight, pop the build-up
  words ("ONE / SACRED PURPOSE") as they are spoken, a nervous bouncing "?",
  then the object descends on its word with sunburst rays, sparkles, a
  heavenly choir, and every face switching to open-mouthed awe.
- **Scheduling chaos on a calendar.** Circle each proposed date on its word,
  cross it on the word that kills it; crosstalk voices overlap, small heads
  and bubbles pop in around the calendar, pages fly past, the calendar shakes.
- **Attrition tally.** "Minus one." The dropout's head flicks off-screen
  spinning with a shocked face while a scribbled 5 is crossed and a red 4
  pops in. The second dropout floats away with the night-shift moon.
- **Record scratch.** At the moment of triumph (confetti, bouncing heads,
  props flying in) the music stops, the frame freezes and drains grey, and
  the culprit slides in large to deliver the bad news.
- **Coin flip on a word.** Tossed on "50/50", lands on "bail" with the losing
  face showing, then a hard cut to a CANCELLED stamp, rain, and every face in
  dismay.
- **Bleep with a censor bar** over the swear word in the bubble.
- **Callback ending.** Reprise the title as the final question, answer it
  with a deadpan quote from the source material stamped twice ("T.B.C." then
  "...OR BOOKED"), finish on everyone around the object, then an end card.

Quote the source (the group chat) for the characters' lines: the real phrasing
was funnier than anything invented.

## Pacing

- Cold open title card 1.2-2.3s with ransom lettering and a stamp subtitle.
- 13 scenes in 61s: 2-6s each, with hard cuts only on stamps and scratches.
- A beat every 1-2s: an entrance, a mark, a stamp, a bubble change.
- End card about 2s: title reprise, a status stamp, a production credit line
  in Caveat.

## Frame

Faces are the point: characters at 330-720px tall, never smaller than about
220px. Keep bubbles away from faces and tails pointing at mouths. Captions
sit on a tape strip at y ≈ 960, so keep the bottom 150px clear in captioned
scenes.
