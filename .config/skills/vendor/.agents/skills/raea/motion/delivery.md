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
- Render the export at `--quality master` (motion graphics and type) or `--quality high` (a film), and versions made
  for notes with no `--quality` flag; name it in lowercase letters, digits and hyphens, with its shape and length:
  `spring-launch-9x16-15s.mp4`. Each version is a new file beside the last, never written over it.
- In the raea app, post each deliverable with `feed_post` and `export: true`, tagged with the same keys across the
  project (`platform:tiktok`, `aspect:9x16`, `cut:15s`, `market:uk`): they become the project's Table, which is how
  the person sees what's done and what's missing. `item_tags` tags one that's already posted. Headless, list the
  files with their shape, length and platform for the person.
- Publishing is the person's. The app's Publish view sends a post to a network, now or at a time, after checking it
  against that network's guidelines; nothing goes out until they press Publish or Schedule. Have the file, its tags
  and, when asked, a caption within the network's limit ready for them.
- When the person finishes the cut in an editor, hand it over in layers. For CapCut, `raea export capcut EDIT.tsx`
  writes a draft entered in CapCut's project list (CapCut must be closed; `-o DIR` writes the draft folder anywhere);
  in the raea app it's Export to, then CapCut, on the render's card, or To CapCut on its page. For Premiere Pro and
  DaVinci Resolve, `raea export xml EDIT.tsx` writes out/xml/NAME with an XML for each: NAME.premiere.xml (Premiere:
  File, Import) and NAME.resolve.xml (Resolve: File, Import, Timeline).
- In each, the footage and sounds are clips of their own files at their trims and gains (the XML points at them
  where they are; the CapCut draft copies them in), placed, cropped and keyframed as the composition moves and fades
  them; everything raea draws is transparent clips, the graphics over the footage and what's under it (a background
  holding footage, the 3D) below; captions are a track of their own, styled as drawn, with their words as an .srt
  beside them. Each export also puts reference.mp4, the composition as raea renders it, in its folder, to set beside
  the editor's timeline.
- The editor gets captions and graphics as pictures. Mark captions so they're their own track (`motion/words`), and
  fix a word in raea and export again: retyped in the editor, it no longer matches the picture.
- Pass on what the export notes. CapCut can't animate a crop: footage whose cut changes over its clip (a split
  screen's seam moving) is cut there as its first frame shows it, its moves and fades keyed. Premiere and Resolve get
  a clip at another speed at its own speed, and a sound's fades to set by hand; Resolve's footage is placed for its
  default Input Scaling (Scale entire image to fit). A Tone graph's music has no file to place.
- Graphics for someone else's edit (a lower third, a title, a logo sting) go out as a transparent movie:
  `raea render gfx.tsx -o out/lower-third.mov --alpha` (ProRes 4444 on a Mac, QuickTime Animation elsewhere;
  `--alpha-codec hevc` for a far smaller file, on a Mac). Draw nothing behind them: no full-frame fill, no background.
- When the deliverable isn't a video: a game as its own program is `raea export-game` (`games`), an app is
  `raea app bundle` signed with the person's own identity (`apps`), and a live composition for another raea is
  `raea bundle --composition-bundle`.

## Why

Every network shows a video inside its own interface, and a frame made for one shape loses its type, its faces or
its hook in another. The numbers that decide this (shapes, lengths, file sizes, caption limits, where the buttons sit)
are the app's own publishing guidelines, generated into reference/platforms.md, so a delivery made to them is one
Publish accepts without a fix. Tags with the same keys across a project are what make the Table a delivery list
rather than a pile of files. An editor finishing the cut needs layers, not a flattened picture: a draft with the
footage as clips and raea's drawing over them keeps every cut and title editable, where an .mp4 bakes them in. The
two XMLs differ only where Premiere and Resolve read the same FCP7 XML differently (each was checked against its own
exports and renders), so one file can't be right in both.

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
- A transparent movie with a full-frame background, which covers the footage it's laid on; or `--alpha` with an
  .mp4, which holds no alpha (raea refuses it: use .mov).
- Exporting to CapCut while CapCut is open. It rewrites its project list when it quits, so raea refuses: quit it first.
- Captions not marked `data-raea-role="caption"`: the layered export can't tell them from the graphics, so they
  arrive inside the graphics track with no .srt.
- A caption or a title retyped in the editor. It's a picture there: fix it in raea and export again.
- NAME.premiere.xml imported into Resolve, or NAME.resolve.xml into Premiere. Each editor reads FCP7 XML's crop,
  scale and position its own way, so each gets its own file.

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
