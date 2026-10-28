| Peaks clipping              | `limiter` last in the chain                 |

## Diagnose before changing the mix

Compare the clean original with the affected audio, or compare speech with silence in the same recording. An unknown voice's absolute spectrum does not establish a tonal defect. If neither reference exists, report the ambiguity before choosing an EQ correction.

## Music under a voice

Duck the bed with a `volume` lane on the music: full level before the voice, down to about 0.3–0.4 while anyone speaks (word timings from `hyperframes transcribe` or the voiceover give the times), back up after. Then carve the bed, which dips only the bands the voice uses: `node <SKILL_DIR>/audio/scripts/carve.mjs --comp index.html` (needs `ffmpeg` and project-local `@hyperframes/core@0.8.46`; provision with `pnpm add -D --save-exact @hyperframes/core@0.8.46` under the configured release-age gate and install-script protections, and stop if unavailable or blocked; `--dry-run` to see the plan). It is the same analysis as Studio's carve panel. It reads only double-quoted attributes (JSON quotes as `&quot;`), so write the bed's chain and lanes that way or it overwrites them. Never put a carve on a voice track.

## Group buses and carve safety

Give clips the same `data-audio-group="<id>"` to treat them as one group. An `<hf-audio-group id="<id>"></hf-audio-group>` element with that id (closed like that: `/>` does not close it) makes the group a submix bus with one `data-fx-chain`, one volume and one automation clock for every member. Keep one role per group: `voiceover`, `music`, `sfx`.

Group narration before carving and keep the bed, music and SFX outside the voice group. A later analysis expands every group member. The helper refuses an unsafe group and reports the offending member. Carve the bed clip, never a voice or a bus. Re-carving replaces only nodes marked `fromCarve` and their automation; preserve hand-authored effects and lanes. Read the generated node ids before wiring further automation.

A group bus's automation uses composition time; a clip's automation uses clip-local time. A `data-fx-chain` on the top-level composition root is the master bus and processes the summed mix once. A sub-composition root does not provide a master bus. Master automation is unsupported.

For delivery peaks use the `truepeak` limiter last in the master chain. It uses lookahead and a 4x estimate; full-band noise can exceed the ceiling by 1.7 dB. Put its ceiling at least 2 dB below a hard delivery limit. `truepeak` cannot be automated. A plain `limiter` has no lookahead.

The detailed retired preset catalogue is not bundled here. List available topics with `hyperframes docs` and inspect the matching audio reference before using a named preset or parameter. If the installed CLI does not document it, author a documented effect chain or report the missing contract. Do not guess parameter names, ranges or preset availability. Verify the rendered audio by listening; invalid chains can play dry in preview while rendering fails.
