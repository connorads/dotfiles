# How a piece is judged

A critique has three parts, and the person sees all three on one test item in the feed:

1. **Measured.** `raea check` on the export: clipped text, text under a platform's buttons, captions too brief to
   read, caption contrast, frozen stretches, flashing past the limit, cues off their words, loudness, blotching in the darks. These are facts;
   a P0 or P1 among them is never argued with.
2. **Judged.** The decision model watches the export (its first minute, with sound) and rates it on the questions
   below, each on five levels: poor, weak, acceptable, strong, excellent. It reads the brief's facts and the
   storyboard's logline first, so it judges this piece for these people, not pieces in general.
3. **Written.** The agent turns every judged answer under "acceptable" into an issue the person can act on: the
   moment, what the viewer meets there, and the move that fixes it (`retime`, `clarify`, `regrade`...). It names the
   strongest moment too, so polish leaves it alone.

## The questions

Each line is `id (modes it applies to): the question`. `all` means every mode. A question that doesn't apply to a
piece's modes isn't asked.

- open (pitch, story, explain): In the first two seconds, is there a picture, a word or a sound that would make this audience stop, and does it raise something the rest of the piece answers?
- point (all): After one watch, could this audience say what the piece wants them to believe in one plain sentence?
- shown (pitch, explain): When the narration claims something, is the thing on screen at that moment, working, rather than only described?
- loop (explain): Does it follow one project through one loop, each step leading to the next, without jumping between unrelated examples?
- pull (story): Does each scene end on something unresolved, so this audience wants the next one?
- land (pitch, story, explain): Does the end land: something this audience can do next, a payoff, or a return to the opening?
- pace (all): Do shot lengths change with what they hold, with no stretch sitting still longer than it earns, and cuts falling on words or beats?
- read (all): Is every word that matters large, sharp against what is behind it, and on long enough to read?
- sound (all): Is the voice clear over everything else, with music and effects marking moments rather than filling space?
- sound-silent (silent): With no voice, do the music and the effects carry it: cuts and moments landing on the beat, each effect marking a moment rather than filling space, nothing muddy? (asked in place of sound when no one speaks)
- world (all): Do colour, type, motion and sound hold one direction from the first frame to the last?
- own (all): With the name covered, could this only be this project, rather than any product in its category?
- feel (play): Does the player's input change the picture right away and in a way they can read?
- again (play): After a failure, is it clear what went wrong and is the next attempt one press away?
- task (tool): Can the task the screen exists for be done without stopping to work out where to look?

## Ranking

| | Means | Do |
|---|---|---|
| **P0** | The piece fails: a floor defect, a wrong fact, the point doesn't come through | Fix before anything else |
| **P1** | This audience would stop watching or stop believing here | Fix in this pass |
| **P2** | It costs attention: a slow patch, a generic part, a mix fighting the voice | Fix if the pass has room |
| **P3** | Finishing: a few frames of timing, an alignment, a colour step | Fix last, or leave |

A judged answer of "poor" is P1, and P0 on `point` or on the mode's own first question (`open` for pitch, `loop` for
explain, `pull` for story, `feel` for play, `task` for tool). "weak" is P2. Measured findings keep `raea check`'s
rank. Torn between two ranks: would this audience leave at this moment? If yes, it's at least P1.

## Passing

A stage's gate opens when its latest critique has no P0 or P1 left. P2 and P3 go to `polish`, which works from the
latest critique and posts the next one.
