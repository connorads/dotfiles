# animate

Notes like these: "it's static", "bring it to life", "make it move", "it feels like a slideshow". Motion added to
something that holds still, so each move says something.

## Assess
- Find what the motion should say at each moment: arrival, emphasis, cause and effect, a change of state. A part
  with nothing to say stays still.
- Find the beats it lands on: the voice's words, the music's hits (`raea song FILE --plot`), the cuts.

## Decide
- What moves first in each beat, and what stays still. The easy default, everything entering at once, means
  nothing leads.
- One easing and one speed for the piece: snappy for a pitch, slower and heavier for a story.
- Whether motion is the answer. A frame that feels static may need a cut (`recut`) or a shorter hold (`retime`), not
  movement.

## Change
- Animate entrances, the one emphasis per beat and exits; leave everything else still.
- One easing family for the whole piece; springs for things with weight, short eases for type (`raea guide
  motion/animating`).
- Stagger related parts by a few frames instead of moving them at once.
- Everything reads the frame (`useCurrentFrame()`), every `interpolate` clamped.

## Verify
- Play it at full speed, then step the frames around each beat: each move starts on its cue and settles before
  the next.
- Nothing moves without a reason you could say in a few words.

## When it goes wrong
- Everything bobs or drifts all the time. Idle motion with nothing to say pulls the eye from what does. Hold it
  still.
- Moves land between beats because they were timed by eye. Take the cues from the transcript and the song's map.
- Type overshoots and wobbles: a spring on text. Use a short ease.
- A part pops or jitters on one frame, from an unclamped `interpolate` or state kept outside the frame.
