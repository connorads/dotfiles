# generate

Notes like these: "show me a few options", "try some versions", "I'm not sure what I want", "give me variants of
the end card". Variants of one element to pick from, not of the whole piece.

## Assess
- Name the one element (a title card, a colour, the hook's first line, a sound) and what the variants should differ
  in. Everything else stays the same.
- Three to five variants; more is a choice nobody wants to make.

## Decide
- The axis the variants differ on. "Style" is too vague an axis. Name it: the colour, the first line, how the title
  arrives.
- How far apart the variants are. Make them far enough apart that a person can choose in one look.
- What to show: stills for a look, short clips for motion or sound.

## Change
- Variants in code: one component with a prop for what changes, one `<Composition>` per variant, rendered as stills
  or short clips side by side.
- Generated media (an image, a sound, a voice): `raea gen` (`raea gen` alone lists its flags); each variant keeps its prompt
  and seed so the chosen one can be made again.
- Make them really different on the one axis, not five shades of the same idea.

## Verify
- Show them together, labelled plainly (A, B, C), with one line each on what it does differently. The person
  picks; then remove the rest from the composition.

## When it goes wrong
- The variants differ in more than one thing, so the person can't tell what they're choosing.
- Five near-identical variants make a choice nobody can make.
- The chosen variant can't be made again because its prompt or seed wasn't kept.
- The variants that weren't chosen stay in the composition.
