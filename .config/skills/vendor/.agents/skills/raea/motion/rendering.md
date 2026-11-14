# Rendering and checking: raea render, raea check, stills

## What to do

- **`raea check` after every real change.** Render with the manifest, then check the export against the floor:
  `raea render edit.tsx -o final.mp4 --manifest render.json` and
  `raea check final.mp4 --manifest render.json --words words.json --perception perception.json [--platform tiktok]`.
  It measures clipped text, text under a platform's buttons, text over the face, captions on too briefly to read,
  caption contrast against the pixels behind them, frozen stretches, flashing past the limit, cues that miss their word, loudness, a sound that
  stops dead or (with `--words`) fights the voice, and encoder blotching in the darks. Each finding is ranked P0 to P3
  with its fix; it exits 1 while a P0 or P1 stands, and `-o check.json` writes them for the critique. An
  exception in the composition (an unclamped value going NaN, keyframes out of order, a phrase `word()` can't find, a
  missing prop) fails the render and names the line.
- **Watch it as a viewer would once the piece is close.** `raea check` measures; it can't judge a frame cropped too
  tight, speech without captions, text that's hard to read, an ending that stops mid-thought, or whether the message
  lands. Look for those in the stills and the sheet before you answer.
- **Stills to look at.** `raea render edit.tsx --at 15,63,144,270 -o stills/` renders those frames as PNGs; `raea media sheet
  final.mp4 -o sheet.png` makes a contact sheet of the export. Pick the moments that matter (each cut, each part's entrance and settled state, the
  hook at 0.5 s, the end card) and look at them all in one batch. Fix everything they show, then look again. Don't take
  one still per tweak.
- **Without `--manifest`**, `raea render` writes the export alone, without the measurements `raea check` reads. Render
  another deliverable from its own file the same way (`raea render NAME.tsx -o NAME.mp4 --manifest NAME.json`) and
  check it.
- **Loudness** comes out at -14 LUFS integrated (±1) with true peak at or below -1 dBTP when `<Mix>` is in the tree.

## Why

The engine renders the same tree the person will get, so a still from it is the truth about layout: fonts, footage,
3D and text overflow only show in pixels. `raea check` measures what a still can't (a clipped word, a frame of
black, dead air), so the two together cover the floor.

Looking in batches is the craft rule. One round of looking at the frames that matter, fixing everything, then
looking again, finds more than a still per change and costs less.

## Common mistakes

- Judging layout from the TSX alone. Text overflow and contrast against footage only show in pixels.
- Checking frame 0 only. Most bugs are at cues and joins.
- Calling it done without listening. The voice must stay intelligible over the bed, and every sound should land on
  its beat.
- Answering while `raea check` still names a fault.

## Bitrate, quality and dark material

A video's bitrate follows its size and frame rate (about 20 Mbit/s at 1080p30, 80 at 4K30; VideoToolbox spends less on
flat pictures), and `--kbps N` sets it. `--quality draft|high|master` (or 0..1: 0.6, 0.85, 0.95) asks for constant
quality instead, each frame getting the bits it needs: `master` keeps thin type and hard vector edges clean at 4K
(about 31 Mbit/s on flat motion graphics). Blotching in dark areas is the encoder, not the composition: export dark
material as PNG frames (`RAEA_READBACK=rgba raea render piece.tsx -o frames/`) and encode them with more bits for the
darks.

## A person's hand edits

A person's hand edit in the raea app comes back as props, so keep them when you revise: `<Composition ... edit={{
segments: [[0, 412], [430, 3285]] }}>` plays those frame ranges one after another (a trim, a split, a cut word), and
`<Nudge x={0} y={-156}>` around an element moves it by those px. Edit the composition under them; change the segments
only when the cut itself should change.
