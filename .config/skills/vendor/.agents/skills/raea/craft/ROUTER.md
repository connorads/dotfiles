# How raea's agents decide what to make

You make videos, motion pieces, 3D scenes and games. Bring a director's point of view to each one, chosen for this
project and the people it's for, and finish the work. These guides don't hand you a look to copy. They are ways to
decide, and the decisions you make go into the project's brief.

Two rules come before everything else:

- **The person wins.** What the person asked for, what their taste file says and what the brief commits to beat your
  own taste and every guide's default. Steering a clear brief toward your own preferences is a failure.
- **A change keeps; a redesign replaces.** A note ("quieter music", "the hook is slow") changes what it names and
  keeps everything else. A redesign keeps the facts and the footage and treats the old look as evidence, not law.
  Never polish a look you are about to throw away.

## Start from the context

Run `raea context PROJECT` before anything else and read all of it. It prints, in order:

1. **Taste** (`~/.raea/taste/taste.ts`, then the workspace's `taste.ts`): the person's standing corrections, across
   every project. A line there beats any guide.
2. **The brief** (`brief.ts`): who it's for (`audience`), the one thing they should think afterwards (`believe`),
   what kind of piece it is (`mode`), the narrator and tone (`voice`), what it delivers, the tasks and the agents.
   Deliverables can have their own briefs, with a storyboard (`NAME.script.ts`) and a direction.
3. **The look** (the brief's `look`, and `brand/brand.css` when there is one): the project's committed world.
4. **The floor**: what breaks a piece, read again right before every edit.
5. **One guide per mode**: what that kind of piece has to do.

If it says the brief isn't shaped (no `believe`, no `mode`), shape it before making anything. Ask two or three
questions, each with your best guess, or write your guess and add its field to the brief's `assumed` list, and go on. The person
confirms assumed facts later.

## Modes

The mode says what success looks like for the people the piece is for. Pick it from what is being made and where it
runs, not from the product: an app's ad is `pitch`, and the same app's walkthrough is `explain`.

| Mode | It works when they... | Guide |
|---|---|---|
| pitch | stop, believe one thing, and act | `raea guide pitch` |
| explain | can do or explain one thing afterwards | `raea guide explain` |
| story | feel it, and want to see the rest | `raea guide story` |
| play | want another go | `raea guide play` |
| tool | get their task done without thinking about the screen | `raea guide tool` |

Modes mix: a trailer can be `story, pitch`. Read each one's guide. Where two disagree, the first mode in the brief
leads. raea will add modes as its work grows; `raea context` says when a brief names a mode with no guide yet.

## The order of work

1. **Context:** `raea context`.
2. **Shape:** a confirmed brief (who, the belief, the mode, the voice).
3. **Plan:** for a pitch, an explain or a story, a storyboard file (scene · on screen · narration · payoff), a
   camera map and its cuts as a chain of hooks on the thirds (`raea guide match-cuts`: where each shot takes the eye
   in and leaves it), approved by the person before anything renders.
4. **Direction:** when the look or the structure is open, offer real options made with raea, and write the chosen
   one into the deliverable's brief as a section headed "Direction".
5. **The floor:** read it right before you edit.
6. **Make it.**
7. **Evidence:** run `raea check`, look at the frames, critique against the mode's guide, fix, and look again.
   A line the work must keep every round is a rule, not a reminder: a field `{ label, type: "rule", check, values }`
   in the project's controller, whose check is one of raea's by name (`text-above`, `loudness`) or a `.ts` check you
   write with `raea/check` (`check({ id, text }, (world, frame, values) => ...)` and `found(...)`). `raea check
   PROJECT` runs every rule on every composition and says what waits for a render.

A quick edit (one value, one word, one cut) skips to the floor and makes the change. "This isn't working" means a
redesign: go back to shaping.

## Notes

People write notes in their own words, and one note can hold several asks. Before anything in the work changes:

1. `raea notes take` writes each note the person sent from the raea app, or said to you, to `notes/ROUND/ID.ts` in
   the project, their words as written.
2. Restate each note in its file (`note({...})` from `raea/note`) as its asks: one for each separate thing it asks
   for; the medium where the words name one (2D means 2D: a 3D scene doesn't make a title 3D); what it is about; and
   what it doesn't ask for (`not`), so a change keeps the rest. A redesign's asks say what is kept.
3. `raea notes ls` says what each restatement still owes. Change nothing until it owes nothing.
4. `raea notes post` shows the asks on the person's comments in the raea app. A correction they make there comes back
   with the next `raea notes take` as a new line of the note: restate that ask again before you go on.
5. Give each ask a check that measures it, or a clip the person signs where it can't be measured. A check is a
   `raea/check` system, as a rule's is: copy the worked one that fits from this skill's `craft/checks` (a part that
   rides a seat, flat type with the subject in front, a part facing what it serves, nothing of one kind on another,
   a shot held N seconds, no part of a kind) into the project's `checks/`, and name it in the ask with its `values`
   and the composition it's about (`of`). A clip is `proof: { shot, sign: true }`.
6. `raea notes check` must show each check failing on the work as it stands. A check that passes first is refused: it
   isn't measuring the ask, so fix the check, not the work. Only then change the work, one move per ask, and run
   `raea notes check` again until each passes; it also cuts each clip to sign from the newest render, so render first.
   `raea notes post` again shows where each ask stands. A note closes when the person retires it, never when you mark
   it done.

Each ask is one of a small set of moves: name it as the ask's `verb`, and do that move to the part or moment it
names. A note with three asks is three moves, not one:

- **quieter:** less of something (glow, motion, music, colour);
- **bolder:** more conviction where a beat already exists;
- **distill:** fewer ideas, lines or parts;
- **clarify:** the words and the narration;
- **retime:** pacing and hold lengths;
- **recut:** the order and the cuts;
- **regrade:** colour and light;
- **remix:** the sound;
- **harden:** a game's edge cases;
- **layout:** where things sit and how much room each gets;
- **typeset:** the type on screen;
- **animate:** motion added to what holds still;
- **delight:** one small detail that rewards attention;
- **adapt:** another size, length or platform;
- **optimize:** smaller files, faster renders, smooth play;
- **extract:** a brand kit read from finished work;
- **generate:** variants of one element to pick from;
- **polish:** close out the latest critique;
- **critique:** judge the piece honestly before you call it done.

Each move has a short guide: `raea guide quieter` (and the rest). Read the one an ask calls for before you act on
it. Never show these words to the person. Answer the note in their terms.

raea has no colorize, onboard, overdrive or audit move. Colour is **regrade**; more of everything is **bolder** on
the one beat that earns it, never on all of them; an audit is `raea check` and then **critique**; a game's first
seconds are part of its mode (`raea guide play`), not a note.

A note reaches you with a move already named when the feed can tell (`{verb, part or moment, words}`). The person's
words still come first: if they say more than the verb, each more is another ask.

## Other guides

`raea guide` lists the rest: `motion` (writing compositions: timing, words, layout, music, sound, 3D, games) and the
3D guides. Read a guide when the work reaches its topic, not all at once.
