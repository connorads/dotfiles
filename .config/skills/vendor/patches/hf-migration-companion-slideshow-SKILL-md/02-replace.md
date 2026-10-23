- **Fragments are absolute timeline times** (the same clock as `data-start`, not offsets inside the slide) within the slide's `[start, end]`. Navigation seeks, it never plays: each hold state must look right when the timeline is seeked straight to that time. A slide without fragments enters at a rest frame inside it.
- **Branch slides** are ordinary scenes listed only in `slideSequences`, never in the main `slides` array. A hotspot's `target` is a sequence `id`; `region` is a percentage box (omit it for a full-slide button). Back returns to the slide that held the hotspot.
- Text the audience must read is at least 40 px at 1920×1080. Before hand-building any named visual, search `hyperframes catalog --query "<the visual, in English>" --json`: it ranks the whole registry with nothing installed.

## Porting an existing page
