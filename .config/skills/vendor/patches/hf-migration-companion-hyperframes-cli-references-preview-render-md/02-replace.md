```

Use the actual port and project directory name; treat `index.html` as source-code context, not the preview surface. For example, after `hyperframes preview --background --port 3017` in `codex-openai-video`, report `http://localhost:3017/#project/codex-openai-video`.

Two ways a handed URL turns out dead — check both before handing it back: the URL is missing its `#project/<project-name>` hash (Studio loads but has no project to open), or the server is not actually running. Bare `preview` automatically creates a managed persistent session in a non-TTY agent shell; `--background` remains the clearest explicit form. Verify the printed URL returns HTTP 200, keep it alive for the whole review, and stop it explicitly with `hyperframes preview --stop` afterward. Use the printed URL as-is: HyperFrames URL-encodes project names that contain route metacharacters.

### Agent context from Studio selection
