# layout

Notes like these: "it's cramped", "where do I look", "everything's the same size", "it's crooked", "too much empty
space", "the logo's lost". Where things sit in the frame and how much room each gets.

## Assess
- Name the one thing each moment is about. Is it the biggest, the brightest or the most central thing in the frame?
- Find what fights it: two things the same size, a part over a face or under a platform's buttons (the safe zones in
  `raea guide motion/placement`), edges that almost line up but don't.
- Look at the frame at the size it ships (a phone for 9:16), not at full resolution.

## Decide
- The focal point of each moment, before you move anything.
- One grid and one margin for the whole piece, from the brand kit when it has them.
- The size you judge at: the size it ships, a phone for 9:16.

## Change
- One focal point per moment. Make it bigger or give it more room; make the rest smaller rather than moving it away.
- Put parts on a grid: shared left edges, shared baselines, the same margin on every side (`raea guide motion/layout`).
- Use the room on purpose: space around the focal point, not spread evenly across the frame.
- Keep text and faces inside the safe zones of every platform the controllers name.

## Verify
- Stills at the same frames, before and after (`raea render --at`), at ship size. The eye goes to the right place first.
- `raea check` reports no overlap or out-of-safe-zone parts.

## When it goes wrong
- Everything is centred and the same size, so the eye has nowhere to go first.
- Space is spread evenly, so the frame looks empty rather than calm.
- A layout fixed for one size breaks in another. Check every composition.
