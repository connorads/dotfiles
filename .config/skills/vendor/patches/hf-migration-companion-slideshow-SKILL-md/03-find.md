
- **Never render a deck to MP4**: `render` keeps only the first scene and truncates silently. For stills, `snapshot --at` each slide.
- Run `npx hyperframes check --json` until it is clean. The slideshow rule checks that every `sceneId` resolves, every hotspot `target` exists, fragments sit inside their slide, and main-line slides don't overlap.
- Serve it with `npx hyperframes present <project-dir>` and hand over the URL it prints: "Click Present, or press P, to open the audience tab."
- The project's root `index.html` should open as a working deck: `<hyperframes-slideshow>` around `<hyperframes-player src="…">`, with the raw composition in a subfolder if needed. The component owns Present (P), Prev/Next, the counter, global mute, fullscreen, swipe, hotspots, presenter notes (editable, kept per deck) and stopping media on slide exit. Don't build your own versions of any of these.
- Screen sharing: in Google Meet share the audience **tab**, which keeps rendering in the background. In Zoom drag the audience tab into its own window and share that; a fully covered window freezes.
