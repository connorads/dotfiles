# Words and captions: word, useWords

## What to do

- Cue parts on what is said. `word(phrase, {occurrence = 1, edge = "start"})` returns the composition frame where the
  phrase starts. `edge: "end"` gives the frame after its last word ends, and `occurrence: 2` the second time it is
  said. Matching is on words and ignores case and punctuation, so `word("sleep study")` finds "Sleep study,".
- Build captions from `useWords()`. It returns every word heard on the timeline as `{text, from, to}` (`to` is
  exclusive), in order and in the frames of the nearest enclosing Sequence. Words cut out of the edit aren't there,
  so captions follow the cut automatically.
- Group words the way the approved pieces do: start a new group after 3 words, after punctuation, or after a gap of
  more than 8 frames. Show a group from its first word until the next group starts (or 8 frames after its last
  word). Light the word being spoken in the accent, and let key words stay lit once said.
- Fix names before they reach the screen. Speech to text mishears names, so map each wrong spelling to the
  spelling in BRAND.md and check every caption, card and end card against it (a floor defect).
- Size captions at 60 px or more at 1080 wide (scale with the width), with at least 3:1 contrast against the pixels
  behind them. Keep them in one place unless a move means something, and keep them off cards, logos, burned-in text
  and the face (`motion/placement`).
- The transcript reaches the render for you: `raea cut` writes words.json beside the edit, and `raea render` reads it
  from there. Give it to `raea check` with `--words words.json`, so the check can match cues to their words.

## Why

A cue tied to a word survives re-cutting. Move a clip and the part still lands as the line is said. A frame
number typed by hand drifts with every trim. That is how two approved pieces came to have captions leading the
voice by 2 or 3 frames: their cuts were trimmed after the frames were written down.

`word()` throws when the phrase is never said, which names the phrase. Treat that as a check: the line isn't in
the cut, or you misremembered it. It also means an edit with no words.json fails at its first cue, so cut with `raea cut`
before cueing.

`word()` reads the clock, so call it while rendering (in a component body), not at the top level of the file.

## Common mistakes

- Writing cue frames by hand from a listen. Use `word()`.
- Calling `word()` at module level: there is no clock there, and it throws.
- Using a `word()` frame inside a Sequence as if it were local. Subtract the Sequence's `from`, or add `from` to
  `useCurrentFrame()` (`motion/timing`).
- Captions longer than the frame's width: they run off, which is a defect. Fix a width and centre them, and keep
  groups short.
- The template caption: white bold, one yellow word, a pop on every group. Take the colour, face and motion from
  the brand and the piece's direction.
- Showing the transcript's spelling of a brand or person's name.
- A caption at 40 px "to keep it subtle". Below 60 px at 1080 wide it can't be read on a phone.

## Example: karaoke captions and a part cued on a phrase

```tsx
import { AbsoluteFill, Composition, Easing, Region, Sequence, interpolate, registerRoot, useCurrentFrame, useWords, word, type TimelineWord } from "raea";
import { css } from "./styles.gen";

const OUT = Easing.out(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** names as BRAND.md spells them, keyed by how the transcript heard them */
const FIX: Record<string, string> = { "twenty,": "20," };

/** Groups of up to 3 words, broken at punctuation and at pauses over 8 frames. */
function group(words: TimelineWord[]): TimelineWord[][] {
  const groups: TimelineWord[][] = [];
  for (const w of words) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    if (!g || g.length >= 3 || /[.,?!]$/.test(prev!.text) || w.from - prev!.to > 8) groups.push([w]);
    else g.push(w);
  }
  return groups;
}

/** Word-by-word captions: the group on screen, the spoken word in the accent. */
function Captions() {
  const f = useCurrentFrame();
  const groups = group(useWords());
  const i = groups.findIndex((g, n) => f >= g[0].from && f < (groups[n + 1]?.[0].from ?? g[g.length - 1].to + 8));
  if (i < 0) return null;
  const g = groups[i];
  const local = f - g[0].from;
  return (
    <div style={{
      width: "100%", textAlign: "center", fontFamily: "var(--brand-font-heading)", fontWeight: 800, fontSize: 84, lineHeight: 1,
      color: "var(--brand-text)", textShadow: "0 4px 24px rgba(0,0,0,0.5)",
      transform: `translateY(${interpolate(local, [0, 5], [24, 0], { ...clamp, easing: OUT })}px)`,
    }}>
      {g.map((w, j) => (
        <span key={j} style={{ color: f >= w.from && f < Math.max(w.to, w.from + 4) ? "var(--brand-accent)" : "var(--brand-text)" }}>
          {(FIX[w.text] ?? w.text) + (j < g.length - 1 ? " " : "")}
        </span>
      ))}
    </div>
  );
}

/** A tag that lands as the phrase is said. */
function TestedTag() {
  const f = useCurrentFrame();
  const at = word("tested"); // composition frame; this part sits in no Sequence, so frames agree
  const s = interpolate(f, [at, at + 4, at + 8], [0.6, 1.08, 1], clamp);
  return f < at ? null : (
    <div style={{
      alignSelf: "center", padding: "20px 36px", borderRadius: 999, backgroundColor: "var(--brand-accent)",
      fontFamily: "var(--brand-font)", fontWeight: 800, fontSize: 64, color: "var(--brand-background)", transform: `scale(${s})`,
    }}>every one tested</div>
  );
}

export default function Captioned() {
  return (
    <AbsoluteFill>
      <style>{css}</style>
      <Region name="top" style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}><TestedTag /></Region>
      <Region name="bottom" style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}><Captions /></Region>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="captioned" component={Captioned} width={1080} height={1920} fps={30} durationInFrames={240} />);
```
