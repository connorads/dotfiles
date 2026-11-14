# Delivery and publishing

Getting finished work to the person and their platforms: the shapes and lengths each network takes, the export's
settings, the share copy, the controllers' delivery specs, the versions kept beside each other, and handing it to
the person, who publishes from the raea app's Publish view. The files under `motion/` are
copies of raea's craft guides (`raea guide NAME` prints the same text).

## Which file to open

| You are... | Open |
|---|---|
| deciding the shapes, lengths and platforms, captions and loudness, the files, and handing them over | [motion/delivery.md](motion/delivery.md) (read it first) |
| a network's shapes, lengths, file and caption limits, and where its interface covers the frame | [reference/platforms.md](reference/platforms.md) |
| rendering the video, stills, quality and bitrate, dark material, the person's hand edits | [motion/rendering.md](motion/rendering.md) |
| the export's format, file names, the share copy | [SKILL.md](SKILL.md) ("7. Deliver") |
| a workspace's delivery spec (sizes, platforms, loudness) | `raea controller ls`, then the controller it names ([reference/files.md](reference/files.md) for its fields) |
| the same piece in several shapes (9:16, 1:1, 16:9) | [motion/compositions.md](motion/compositions.md) |
| keeping clear of a platform's UI zones | [motion/placement.md](motion/placement.md) |
| posting a deliverable in the app: `feed_post` with `export` and key:value `tags` | [reference/feed.md](reference/feed.md) |
| a note that the piece doesn't fit somewhere ("it's cut off on TikTok") | [craft/verbs/adapt.md](craft/verbs/adapt.md) |

## The verbs

- `raea render EDIT.tsx -o out/NAME.mp4 --quality master --manifest out/render.json` (HEADLESS), then `raea check`.
- `raea check FILE --shape 9:16 --platform tiktok|reels|shorts` measures it against where it goes: text under the
  network's buttons, captions too brief to read, loudness.
- `raea media probe|loudness FILE` to confirm what the file is before it leaves.
- `raea bundle EDIT.tsx --composition-bundle -o OUT.js` packs a composition to be drawn by render_bundle elsewhere
  (on the Mac or the iPhone), when the deliverable is the live composition rather than a video.
