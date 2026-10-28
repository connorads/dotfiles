| Peaks clipping              | `limiter` last in the chain                 |

## Music under a voice

Duck the bed with a `volume` lane on the music: full level before the voice, down to about 0.3–0.4 while anyone speaks (word timings from `npx hyperframes transcribe` or the voiceover give the times), back up after. Then carve the bed, which dips only the bands the voice uses: `node <SKILL_DIR>/audio/scripts/carve.mjs --comp index.html` (needs `ffmpeg` and `@hyperframes/core` in the project; `--dry-run` to see the plan). It is the same analysis as Studio's carve panel. It reads only double-quoted attributes (JSON quotes as `&quot;`), so write the bed's chain and lanes that way or it overwrites them. Never put a carve on a voice track.

## Group buses

Give clips the same `data-audio-group="<id>"` to treat them as one group. An `<hf-audio-group id="<id>"></hf-audio-group>` element with that id (closed like that: `/>` does not close it) makes the group a submix bus with one `data-fx-chain`, one volume and one automation clock for every member. Keep one role per group: `voiceover`, `music`, `sfx`.
