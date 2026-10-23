
```bash
hyperframes browser ensure    # find or download the pinned Chrome
hyperframes browser path      # print the browser executable path (for scripting)
hyperframes browser clear     # remove the cached Chrome download
```

Manage the Chrome build HyperFrames uses for rendering. The pinned version exists because pixel output drifts across Chrome versions — using the bundled build keeps rendered output reproducible across machines.

Use `path` to embed the binary in scripts: `$(hyperframes browser path)`.
