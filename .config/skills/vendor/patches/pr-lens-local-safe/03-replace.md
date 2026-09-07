   Hand the local SVG back by default. Do not push a canvas unless the user explicitly asks to publish it to PR Lens. Before pushing, state that the complete `drawn.graph.json` goes to `prlens.dev` and the resulting view is public without a login. The document can expose repository identity, commit SHAs, file paths, line references and inferred architecture.

   ```bash
   pnpm dlx @coldtea/pr-lens-cli@0.4.0 canvas push
   ```

   The command prints three links. Give the user the view link, `https://prlens.dev/c/{id}`. The edit link, the one ending in `#w=…`, lets its holder push over the canvas, so leave it out of the reply unless they ask, and never paste it anywhere public. The embed link serves the top view as an SVG for a README.
