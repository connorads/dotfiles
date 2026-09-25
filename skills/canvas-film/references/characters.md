# Characters, props and backgrounds

How photos of real people became a consistent illustrated cast with talking
and reaction faces, and how props and backgrounds were made to match. Image
generation was gpt-image-2 edits (photo in, illustration out); the steps
carry to any model that takes reference images.

## Contents

- Identify people first
- Source crops
- The cast, in order
- Variants for lip-sync and reactions
- Props and backgrounds
- Files and sizes

## Identify people first

Never guess who is who from names. Number each person in one group photo
(position, hair, clothing), ask the user to map numbers to names, then find
each person's best face across all photos: large, sharp, unobstructed,
roughly frontal. A person's clothing differs between photos; describe the
one you use.

## Source crops

- Crop generously around head and shoulders from the full-resolution photo.
- Re-save every crop as an 8-bit PNG before using it as a reference: phone
  "UHDR" JPEGs are 16-bit and edits reject them (`invalid_image_file`).
- A face partly hidden (another head in front, a hand on the cheek): run a
  photographic edit on the crop first. "Remove the other man's head and the
  hand; reconstruct his jaw, chin and neck; keep his face, eyes, nose, hair
  and expression exactly unchanged; plain grey background." The result stayed
  recognisable and was then caricatured like the others.

## The cast, in order

1. Draw the clearest person first and iterate until the style is right. The
   prompt that worked (one person per call, the photo as Image 1):

   > Whimsical hand-drawn caricature in a British storybook collage style:
   > confident loose black ink linework with slight wobble, gouache and
   > coloured-pencil texture, visible paper grain, gently exaggerated friendly
   > caricature proportions (slightly bigger head), warm muted palette.
   > Rendered as a cut-out paper sticker: the character is cut out with a
   > thick uneven hand-scissored white paper border around the whole
   > silhouette. Transparent background, nothing else in frame. Head and
   > shoulders to mid-chest, facing the viewer at a slight three-quarter
   > angle, mouth closed in a relaxed friendly smile. Must be clearly
   > recognisable as the same person in the reference photo: keep face shape,
   > hairline, hair, facial hair, eyebrows, eye shape, nose and ears
   > faithful. Portrait orientation, 4:5 aspect ratio.

   Add a short description of the person in brackets (hair, facial hair,
   clothing) naming what must survive.
2. Every other person: their photo as Image 1, the finished first character
   as Image 2 with "style reference only - match its drawing style,
   colouring, sticker border and framing exactly, but do NOT copy its
   person". Run them in parallel. All four matched the first on the first try.
3. Show the user the lineup before building on it.

The style paragraph is the style pack's; swap it for another style's.

## Variants for lip-sync and reactions

Make each variant as an edit of the finished character (Image 1 = edit
target), never as a fresh generation:

- `talk`: "Keep EVERYTHING identical - same drawing, same person, same pose,
  head position, size, framing, clothing, linework, colours, white sticker
  border and transparent background. Change ONLY the mouth and jaw: mouth
  wide open mid-sentence, showing top teeth, jaw slightly dropped."
- a reaction, e.g. `shock`: same preamble, "Change ONLY the facial expression
  to comic dismay: eyebrows raised and tilted up in the middle, eyes wide,
  mouth open in a small aghast O shape."

Variants came back at the same size and framing, so the engine swaps the
whole image while the character's own voice is loud (`head()` in the
engine): stop-motion replacement animation, no mouth rigging. The open-mouth
variant also doubles as "awe" and "cheering" when forced.

Budget: 5 characters x 3 images, about 45s per call, run 5-10 in parallel.

## Props and backgrounds

Pass the first character as a style reference for every prop too, with
"Image 1 is a style reference only (do not draw that person)". Props as
stickers ("drawn as a single cut-out paper sticker with a thick uneven
hand-scissored white paper border, on a transparent background, nothing
else in frame, no text"); backgrounds opaque at 16:9.

- Put any required sign text in the prompt verbatim ("a sign reading exactly
  'THE CURRY HOUSE'"); it rendered correctly. Say "no text" everywhere else.
- Very wide requests (21:9 hedge strip) came back thin; scale them up in the
  scene rather than regenerating.
- A call can time out; rerun that one alone.
- Plan props from the script: one per gag object (food, drink, moon for a
  night shift, candelabra for a date, rain cloud for a cancellation), plus
  one location sticker (a shopfront) and 2-3 full backgrounds (paper
  texture, a painted habitat, a display case).

## Files and sizes

- `assets/img/<name>_rest.webp`, `<name>_talk.webp`, `<name>_<expr>.webp`;
  `<name>` must equal the speaker name in `film.json` so voices drive mouths.
- Characters 560x700 WebP (q88, alpha q90); props max 900px; backgrounds
  `bg_*.webp` at 1920x1080 (2300 wide if the scene pans). 29 images came to
  4.6 MB and the whole page to 9 MB.
- Do not trim variants individually: the swap needs identical canvases.
