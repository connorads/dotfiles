   If the user asked for a diagram, an explanation or a picture of the architecture and nothing more, put it on a canvas and hand back the link:

   ```bash
   npx @coldtea/pr-lens-cli@latest canvas push
   ```

   This pushes `.pr-lens/drawn.graph.json` and prints three links. Give the user the view link, `https://prlens.dev/c/{id}`: that is the diagram, full screen, every view on one page, and it opens without a login. The edit link, the one ending in `#w=…`, lets its holder push over the canvas, so leave it out of the reply unless they ask, and never paste it anywhere public. The embed link serves the top view as an SVG for a README.
