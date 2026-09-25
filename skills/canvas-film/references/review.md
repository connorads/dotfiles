# Review and render

A clean `build`, a render that exits 0 and a page with no errors say nothing
about whether the film works. Each check below caught something the previous
ones passed.

## Contents

- Stills at every beat
- What to look for
- Render
- The final checks

## Stills at every beat

`film.py snap <dir> <t...>` renders chosen times through the real page and
writes `build/snaps/sheet.jpg` (two per row). Pick times from
`build/timeline.json`: each scene's midpoint, just after each anchored word,
each transition midpoint, the first and last second. 8 stills per sheet read
comfortably; batch the film into 3-5 sheets. Re-snap only the times a fix
touched.

## What to look for

Issues found this way on one film, all invisible to the code:

- text running off the frame (a long ransom title) or clipped bubbles;
- a prop covering a face (a candelabra in front of the speaker);
- a moving object crossing a speech bubble's text (a coin arc);
- a stamp overlapping heads, or tinting a sticker it overlaps (multiply);
- marks drawn off-canvas or invisible (black ink on a night background);
- labels crowding each other when the longest string is rendered;
- the same moment captioned twice (caption tape repeating on-screen words).

## Render

`film.py render <dir>` steps every frame through `renderAt(i / fps)` in
headless Chromium, pipes JPEGs to ffmpeg with the soundtrack, and writes:

- `dist/<name>.mp4`: 1080p30 x264 CRF 19. Per-frame paper grain makes this
  large (about 2 MB/s).
- `dist/<name>-share.mp4`: 3.8 Mbps, about 30 MB for a minute. Send this one
  to chat apps.

A 61s film took about 5 minutes. 30fps suits the 12fps boil; higher rates
add file size, not smoothness.

## The final checks

1. `film.py sheet dist/<name>.mp4` makes a one-frame-per-second contact
   sheet of the actual video. Scan it for dead air: two or three adjacent
   frames that look the same while the narration talks about something. Two
   such spots survived every still check on the first film (an empty stage
   before a reveal, a blank page before a flurry).
2. `film.py stt dist/<name>-share.mp4 --find <punchline words>`: the
   transcript must read as the script, bleeped words absent, and each
   punchline word at the time its visual lands.
3. `film.py playtest <dir>`: the HTML plays in a browser with sound (audio
   time advancing, no page errors).
4. Report length, sizes, and anything you could not check (you did not
   listen to the voices; say so).
