# Parts: a talking take, dressed by name

The reel's parts are designed parts for a talking take. They're an example the project owns: `raea part add reel`
copies them into components/reel/, yours to change, and you import them from "./components/reel". You place each one
with one line, and each one lands on the words that say it. You don't lay out boxes or count frames. You choose which
part goes on which beat, and what it says.

A whole file: the parts go inside `<Ad>` in the piece's component, and `registerRoot` takes a function that returns the
`<Composition>`, which names that component. Never put `<Ad>` inside `<Composition>`: a Composition doesn't render its
children, so nothing would show and nothing would be heard.

```tsx
import { take, bed, SEGMENTS, FACE, FRAMES } from "./take.gen";
import { Composition, Mix, registerRoot } from "raea";
import { Ad, Bed, Captions, Follow, Hook, StatCard, Strike, Take } from "./components/reel";

function Piece() {
  return (
    <Ad>
      <Take src={take} segments={SEGMENTS} face={FACE} />
      <Hook say="nine in ten" text="*9 in 10* / buyers / read reviews first" />
      <StatCard say="only a third" big="33%" text="of shops / answer / *within a day*"
        bars={[{ label: "answer in a day", value: "33%", fill: 0.33 }, { label: "buyers who wait", value: "~10%", fill: 0.1, say: "wait" }]} />
      <Strike say="what works is" text="what works / *a fast reply*" not="not another / discount code" strikeSay="discount code" />
      <Follow say="be sure" text="+ follow for more" />
      <Captions keys="reviews, reply" />
      {bed ? <Bed src={bed} /> : null}
      <Mix lufs={-14} />
    </Ad>
  );
}

registerRoot(() => <Composition id="reviews-reel" component={Piece} width={1080} height={1920} fps={30} durationInFrames={FRAMES} />);
```

## Cues: every part has them

- `say`: the phrase the part lands on, **word for word from the transcript** (case and punctuation don't matter). Two or three words that are said only once. If the phrase is never said, the render stops and names the part. Every part in the band but Phrases gets one (or `beat`): without it a part starts at the piece's first frame, not at its line. Phrases starts on its first phrase by itself.
- `until`: the phrase it leaves on, at the end of that phrase's last word. Without it, the part runs its own length, or until the next part in the top band starts.
- `seconds`: its length, when there's no `until`.
- `occurrence`: which time `say` is said, when a phrase repeats.
- `place`: where it sits. `"top"` (over the head, the default), `"upper"` (lower, over the forehead) or `"middle"` (over the face: for a line that should take the whole picture). Captions keep out of its way wherever it sits. Use it to answer a note about a part's position.
- `sound`: foley on its moment. Each part has its own by default, so leave this alone, or write an SAO prompt, or `false` for none.

## Footage with no voice: cue on the beats

A screen recording or b-roll has no words to cue on, so it's cut on its music bed. The host cuts the shots on the bed's
beats and gives `BEATS` (each beat's frame in the cut) and `SHOTS` (where each shot looks). Pass `<Ad beats={BEATS}>`,
and cue each part by beat:

- `beat`: the beat it lands on, counted from 0. A part on a shot's first beat lands on its cut.
- `untilBeat`: the last beat it's up for; it leaves as the next beat starts. A part stays up at least 1.5 s (a bar at most tempos), or the render stops and says which part. Without it, the part runs its own length, or until the next part in the band.

```tsx
import { take, bed, SEGMENTS, SHOTS, BEATS, TONE, FRAMES } from "./take.gen";
import { Composition, Mix, registerRoot } from "raea";
import { Ad, Bed, Callout, EndCard, Hook, Take } from "./components/reel";

function Promo() {
  return (
    <Ad beats={BEATS} tone={TONE} accent="#ff7a1a">
      <Take src={take} segments={SEGMENTS} shots={SHOTS} gain={-20} />
      <Hook beat={0} untilBeat={7} text="plan the week / *in a minute*" />
      <Callout beat={8} untilBeat={15} label="1/3" title="Pick your days" place="middle" />
      <EndCard beat={40} name="Weekly" line="Your week, sorted." cta="weekly.app" />
      {bed ? <Bed src={bed} gain={-15} /> : null}
      <Mix lufs={-14} />
    </Ad>
  );
}

registerRoot(() => <Composition id="weekly-promo" component={Promo} width={1080} height={1920} fps={30} durationInFrames={FRAMES} />);
```

Pass `tone={TONE}` too: on a bright screen the host says "light", and type over the footage turns dark with no grade under it. A card or callout stays up at least a bar so it can be read. Leave out `<Captions>`: nothing is said. The sound is done here too: with `beats`, the parts make a screen piece's foley (a thud on a landing and on each quick cut, a pop on each card), louder than under a voice. Part text comes from the footage's own words, shortened. A screen recording has its own headline at the top, so a card or callout over it goes at `place="middle"`, or the shot zooms in on its subject (`SHOTS` comes from your picks) so the headline is out of the frame.

## The parts

| Part | Props | Use it for |
|---|---|---|
| `<Take src segments face punch gain>` | `segments`: the kept stretches in the take's seconds, `[[from, to], ...]`; `face`: `{x, y}` shares | the footage, first inside `<Ad>`. The host gives you `segments` and `face`; use them as given |
| `<Hook text>` | `text`: two or three lines, `" / "` between them; a line wrapped whole in `*stars*` is the accent line and pops | the opening line (and a short line worth shouting before the thesis, never the thesis itself) |
| `<StatCard big text bars>` | `big`: the number (`"2%"`); `text`: up to three short lines; `bars`: up to two `{label, value, fill (0..1), say}` | a number the speaker **says**, never one you make up |
| `<Strike text not strikeSay>` | `text`: what's right; `not`: what's wrong, on a card, at most two lines; `strikeSay`: the phrase the strike lands on | "not this, but that" once the thesis is up: the wrong way, named, struck. The thesis's own "not X, but Y" is Phrases |
| `<Phrases text>` | `text`: short phrases the speaker says in turn (it starts where its first phrase is said, so it needs no `say`), `" / "` between them, each word for word (two or three words, as said in one breath); `*word*` accents; it holds until the next part in the band, or give `until` the last phrase's words when the band should empty after it | the thesis, said phrase by phrase: each phrase big on its own, landing on its words and held until the next |
| `<Callout label title detail>` | short words | a step, a claim, a name |
| `<Follow text>` | `"+ follow for more"`: one line; it sits on the accent, so it takes no stars | the ask, when the speaker asks |
| `<EndCard name line cta logo>` | | a brand's close over the whole frame |
| `<Captions keys fix>` | `keys`: words that stay lit once said; `fix`: `"heard=shown"` pairs | always, once, inside `<Ad>` |
| `<Bed src gain>` | | the music under the voice (the host gives `src`) |

`*word*` lights a word in the accent inside any text. Keep lines short: a hook line has two to four words, and a card
line has one to three.

## How a piece reads

- **One part per beat.** The top band (above the face) holds one part at a time. A part ends where the next one starts, so don't stack two on the same words.
- **Open with a Hook** on the first line said. End with the ask (Follow) or an EndCard if there is one. The last one holds to the end of the piece by itself (give it no `until` or `seconds`), so the piece ends on the ask, not on a caption.
- **The parts echo the voice.** A part's words are the speaker's words, shortened. They never contradict the speaker or add a claim.
- **Captions are always on.** They move under a card, hide under a hook, a strike or the ask, and go big at the top when the band is empty. Leave some beats empty so the face and the captions carry them.
- **The thesis gets Phrases.** The thesis is the first line where the speaker says what the brief's `believe:` line means (the believe line finds it; its own wording never goes on screen): the line the piece is about, often the turn after the numbers, and often said as "not this, but that" ("so the fix isn't / another *discount* / it's a *fast reply*"). It reads phrase by phrase: one `<Phrases>` over it, a phrase per breath, the word that carries each phrase in the accent. Captions alone show it three words at a time, lit word by word, which reads as a caption, not a statement.
- **About one part every three to five seconds.** A beat with nothing to show stays empty.
- The sound is done for you. Each part brings its own hit, and `<Bed>` plus `<Mix lufs={-14} />` finish it. Don't add more foley.
