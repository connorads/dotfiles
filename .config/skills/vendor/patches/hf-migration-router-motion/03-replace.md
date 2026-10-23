
- `hyperframes keyframes --json [--selector '#id'] [--runtime all]` lists keyframes and motion paths (GSAP, CSS, anime.js): property, time, value, ease.
- `hyperframes keyframes --shot motion.png --selector '#id'` draws the real element's samples over time with its path (9 samples; `--samples N`). `--layout strip` for motion in place, `--from`/`--to` for one stretch, `--angle iso|top|side|'yaw,pitch'` for 3D, `--ghost` for a `<canvas>`.
- `hyperframes snapshot --range 2,4 --frames 8` samples one stretch; `--composition <id>` samples one scene; `--at <t,…>` exact instants; `--zoom '#id'` a sharp crop; `--angle iso` depth and overlap.
- Against a reference video: `snapshot --at <t,…> --against ref.mp4` writes a side-by-side sheet.
