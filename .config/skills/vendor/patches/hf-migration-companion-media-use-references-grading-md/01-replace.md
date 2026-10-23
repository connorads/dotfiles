assemble those from a generic LUT plus handmade CSS vignette/grain/opacity.

**Never `cat`/read a `.cube` file into context.** A 3D LUT is ~size^3 lines of raw numbers (33^3 ≈ 36k lines at the default size). It bloats context and carries zero human/agent-legible signal. To understand or choose a LUT, use `hyperframes grade-compare` to see it rendered. `hyperframes media-use resolve --type lut --intent "<look description>" --project .` validates generated or downloaded LUTs before freezing them; the validator is bundled in the CLI, not shipped as a standalone skill script. Read `<project>/.media/index.md` or `luts/index.json` for the description. Never read the LUT body itself.

```bash
hyperframes media-use resolve --type grade --intent "warm daylight" --project . --json
```
