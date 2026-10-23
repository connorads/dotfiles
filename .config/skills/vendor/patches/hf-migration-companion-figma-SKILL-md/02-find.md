## Commands

- A layer, logo or image: `npx hyperframes figma asset '<url or fileKey:nodeId>' [more refs] --format svg|png --scale 2 --description "<what it is>" [--entity "<brand mark>"]`. SVG for vectors and logos, PNG at 2x for raster. Several nodes of one file in one call render in a single request; `--entity` lets `/media-use` find a brand mark later.
- Brand colours and type: `npx hyperframes figma tokens <fileKey>`. Run it before `component` and paste the printed entries into `data-composition-variables`. Without Enterprise it falls back to published styles. A connector can supply variables there instead: cache its raw response in `.media/figma-cache/` and write the bindings to `.media/figma-bindings.jsonl` (`{kind:"binding", figmaId, sourceFileKey, compositionVariableId:"figma:<name>", version}`).
- A frame as editable HTML at exact geometry: `npx hyperframes figma component '<url or fileKey:nodeId>'`, packaged under `compositions/components/<name>/`. A fill bound to an imported token comes out as `var(--slug, #literal)`, so one variable re-brands every import; an unknown token stays a literal marked `data-figma-unresolved`: import that library's tokens and re-import. Ask once which file a library is; never match by hex.
- Check hero components against Figma's pixels (`figma asset <same node> --format png`). Text drift is the usual cause; report drift you can't fix instead of hand-tweaking the import.

## Motion (connector)

Usage beacon: these phases have no CLI touchpoint, so run `npx hyperframes events --skill=figma-motion` when you begin and `npx hyperframes events --skill=figma-motion --event=skill_completed --outcome=success|error` when done. Same for shaders (`figma-shaders`) and storyboards (`figma-storyboard`).

1. Fetch motion context for the parent frame in one recursive request; cache the raw JSON in `.media/figma-cache/`.
