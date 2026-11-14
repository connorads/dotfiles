# Delivery: shapes, platforms, the files and handing them over

## What to do

- Start from what's asked for. The brief's deliverables say the pieces; the workspace's delivery controller, when
  there is one (`raea controller ls`, or `controllers_read` in the app), says the shapes, lengths, platforms, caption
  rule and loudness for every piece. Work to it. When neither says where a piece goes, ask once with your best guess,
  or write the guess and add it to the brief's `assumed`.
- Make each shape as its own composition from the same scenes (`motion/compositions`), laid out for that shape: a
  vertical cut puts its type and faces where a vertical frame has room, it doesn't crop the wide one. Name them by
  shape (`launch-9x16`, `launch-1x1`, `launch-16x9`).
- Make the shape a platform is made for first: the first shape listed for it in the skill's reference/platforms.md
  (9:16 for TikTok, Reels and Shorts). A network that shows several shapes takes the one the brief favours.
- Fit the length to where it goes: inside the platform's limits, and near the length its feed favours when the brief
  doesn't set one. A cutdown (6 s, 15 s, 30 s) is its own edit with its own hook, not the long one stopped early.
- Keep text and faces out of the platform's UI zones for that shape (reference/platforms.md; `motion/placement` for
  how), then check the export against the platform:
  `raea check out/launch-9x16.mp4 --manifest out/render.json --shape 9:16 --platform tiktok`.
- Captions: burn them in for feeds that play without sound, unless the delivery controller says captions off; then
  burn none, and leave the words file beside the export for the platform's own captions.
- Sound to -14 LUFS integrated with true peak at or below -1 dBTP: one `<Mix lufs={-14} ceiling={-1.5} />` per
  composition does it (`motion/sound`). A spec that names another number wins.
- Render the export at `--quality master`, named in lowercase letters, digits and hyphens, with its shape and length:
  `spring-launch-9x16-15s.mp4`. Each version is a new file beside the last, never written over it.
- In the raea app, post each deliverable with `feed_post` and `export: true`, tagged with the same keys across the
  project (`platform:tiktok`, `aspect:9x16`, `cut:15s`, `market:uk`): they become the project's Table, which is how
  the person sees what's done and what's missing. `item_tags` tags one that's already posted. Headless, list the
  files with their shape, length and platform for the person.
- Publishing is the person's. The app's Publish view sends a post to a network, now or at a time, after checking it
  against that network's guidelines; nothing goes out until they press Publish or Schedule. Have the file, its tags
  and, when asked, a caption within the network's limit ready for them.
- When the deliverable isn't a video: a game as its own program is `raea export-game` (`games`), an app is
  `raea app bundle` signed with the person's own identity (`apps`), and a live composition for another raea is
  `raea bundle --composition-bundle`.

## Why

Every network shows a video inside its own interface, and a frame made for one shape loses its type, its faces or
its hook in another. The numbers that decide this (shapes, lengths, file sizes, caption limits, where the buttons sit)
are the app's own publishing guidelines, generated into reference/platforms.md, so a delivery made to them is one
Publish accepts without a fix. Tags with the same keys across a project are what make the Table a delivery list
rather than a pile of files.

## Common mistakes

- A 16:9 master cropped to 9:16 at the end. The type runs off the sides and the face sits under the buttons. Lay the
  vertical out as its own composition.
- Text in the bottom quarter of a vertical frame, where every short-video network puts its caption and buttons.
- A 15 s cutdown that is the first 15 seconds of the long cut, with no ending.
- Captions burned in on a piece whose delivery controller says captions off, or burned in twice: once by the piece,
  once by the platform's auto-captions the person turned on.
- `final-v2-FINAL.mp4`, `Launch Video (1).mp4`, or a new render written over the version the person last saw.
- Tags that change keys between items (`tiktok`, `platform:TikTok`, `network:tiktok`): the Table makes three columns.
- Posting to a network, or asking the person for their password to. Publishing is the person's, from Publish.

## Example: one piece in the three shapes it ships in

```tsx
import { AbsoluteFill, Composition, Sequence, registerRoot, useVideoConfig } from "raea";
import { css } from "./styles.gen";

const fps = 30;
const s = (sec: number) => Math.round(sec * fps);

/** The hook and the end card, laid out from the frame's own shape. */
export default function Launch({ cut }: { cut: number }) {
  const { width, height } = useVideoConfig();
  const tall = height > width;
  const u = width / 1080;
  return (
    <AbsoluteFill style={{ background: "var(--brand-background)" }}>
      <style>{css}</style>
      <Sequence from={0} durationInFrames={s(cut) - s(2)}>
        {/* a vertical frame keeps its line in the upper middle, clear of the caption and buttons below */}
        <AbsoluteFill style={{ justifyContent: tall ? "flex-start" : "center", alignItems: "center", paddingTop: tall ? height * 0.3 : 0 }}>
          <div style={{ fontFamily: "var(--brand-font-heading)", fontWeight: 800, color: "var(--brand-text)", fontSize: Math.round((tall ? 110 : 90) * u), textAlign: "center", maxWidth: width * 0.8 }}>
            Sun in a can.
          </div>
        </AbsoluteFill>
      </Sequence>
      <Sequence from={s(cut) - s(2)} durationInFrames={s(2)}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", color: "var(--brand-text)", fontSize: Math.round(72 * u) }}>
          Try Sunmelt
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
}

function Root() {
  return (
    <>
      <Composition id="launch-9x16-15s" component={Launch} width={1080} height={1920} fps={fps} durationInFrames={s(15)} defaultProps={{ cut: 15 }} />
      <Composition id="launch-1x1-15s" component={Launch} width={1080} height={1080} fps={fps} durationInFrames={s(15)} defaultProps={{ cut: 15 }} />
      <Composition id="launch-16x9-30s" component={Launch} width={1920} height={1080} fps={fps} durationInFrames={s(30)} defaultProps={{ cut: 30 }} />
    </>
  );
}
registerRoot(Root);
```

Then each one rendered, checked against where it goes and posted as a deliverable:

```sh
raea render launch.tsx --composition launch-9x16-15s --quality master -o out/launch-9x16-15s.mp4 --manifest out/9x16.json
raea check out/launch-9x16-15s.mp4 --manifest out/9x16.json --shape 9:16 --platform tiktok
```
