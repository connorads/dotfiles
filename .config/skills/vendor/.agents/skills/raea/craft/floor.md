# The floor

Read this right before you edit a composition, every time, even for a one-line change. The floor isn't a style. It
lists what breaks a piece, plus the habits that have already been corrected once. Each line here came from a real
note on real work. When the person's taste file (`~/.raea/taste/`) says otherwise, the taste file wins.

Work through it on one render, not one line at a time. Pull stills at the moments that matter, look at them together,
fix everything they show, then render and look again.

## Verify

Before you say a piece is done, every line here is true of the last render, not of the code:

- **Text fits.** No word runs off the frame, off its card or into the next line. Text that has to be read is at
  least 60 px at 1080 wide (scale with width), with at least 3:1 contrast against the pixels behind each glyph.
- **Text stays out of the app's buttons.** In a vertical frame with the platform unknown, keep the top 220 px, the
  bottom 420, the right 140 and the left 60 clear (TikTok: top 108, bottom 320, right 120; Reels: top 210, bottom 310,
  right 84; Shorts: top 120, bottom 300, right 96). A 4:5 feed frame needs top 110, bottom 170, sides 60; a 1:1 frame
  top 70, bottom 120, sides 60; 16:9 top and bottom 120, sides 60. These zones are only where text can't go. Where it
  should go is a design choice.
- **Nothing flashes past the limit.** No more than three flashes in any one second over a sizable part of the frame
  (WCAG 2.3.1): past that, flashing can cause seizures. A strobe or a fast flicker needs slowing, shrinking or less contrast.
- **Cues land on their words.** A cut, a move or a caption tied to speech starts on the word, timed from the
  transcript's word times. Never place one by eye or at a fixed tempo.
- **Every name the voice says is on screen when it says it.** If the narration says "the brief", the brief is visible.
- **Nothing stands still for three seconds** unless the stillness is the point. A held frame needs a reason the viewer
  can feel.
- **Reading time.** About 0.3 s a word, and at least a second for anything that has to be read. A number gets time
  to land before the next thing replaces it.
- **The mix.** -14 LUFS integrated (±1), true peak at or below -1 dBTP, and the voice clear over everything.
  Changing the target needs the person's say-so.
- **Names are spelled right.** People, products and places are spelled as the brief has them, never as the
  transcript heard them.
- **You looked.** You have seen the frames at the moments that matter, at the size it ships, and opened the whole
  export, not just a shot.
- **A note got its move.** Before any edit for a note, you picked the move it asks for (`raea guide router` lists
  them) and read that move's guide (`raea guide layout`, `raea guide quieter`, ...).
- **The last version is still there.** Each version renders to a new file beside the old (`card-v2.mp4` next to
  `card.mp4`), never over it, and in the app it's posted naming the item it `replaces`.

## Refuse

Each of these was corrected once. Don't make the same mistake twice. One is allowed only when the brief or the
direction asks for it by name, and the direction then says why in a line.

- **Close-ups with no reason.** A cut to a detail has to answer something the viewer just wondered about.
- **Wide, empty shots.** Frame close or medium on a subject: a person, a product, the thing that's happening.
- **Cameras that ease from A to B and stop.** A camera keeps moving at the start and end of a shot, so cuts join
  motion to motion. Stop only when following a subject that stops.
- **Cutting to a constant tempo.** Cut to the song's map (its beats, downbeats, builds and drops), never to a BPM
  times a bar count.
- **Effects stacked until the work blurs.** Bloom, grain, blur, glow and lens tricks that soften or de-rez what the
  piece is about. One effect, used where it means something.
- **Glow on everything.** Light is a cue: it pulses where the eye should go and nowhere else.
- **Drawn highlights where a cursor should act.** In a walkthrough, a real cursor moves and clicks; outlines and
  boxes don't stand in for it.
- **A tour of features.** Follow one project through one loop. A list of capabilities isn't a story.
- **A random script.** Plan it first (who it's for, the one belief, then a storyboard) instead of writing lines
  for whatever is on screen.
- **Template captions.** White bold text with one yellow word, an emoji pop, a zoom on every sentence, a whoosh on
  every entrance.
- **The same move everywhere.** One entrance, one zoom or one sound on every beat makes every beat weaker.
- **Copy that sounds like an ad.** Buzzwords, "Not X. Y." cadences, aphorisms, a label above every headline.

## Never

No reason makes these right:

- **Invented facts.** No number, result, price, quote, customer or comparison that the brief, the person or the
  footage didn't give you. If the piece needs proof you don't have, make it without the proof and say what would help.
- **Generated images or video.** Pictures come from real footage, stock in the project's media, or are built:
  components, drawn shapes, 3D. Generated sound is allowed: TokenSynth instruments, SAO foley and Pocket TTS
  narration (all local).
- **Redrawn logos.** Use the real files.
- **Calling it done without looking.** A render nobody looked at isn't finished.
