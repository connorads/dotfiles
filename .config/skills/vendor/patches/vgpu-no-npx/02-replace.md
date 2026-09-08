```sh
pnpm dlx vgpu@latest docs cat getting-started.md
```

Where neither the project nor the user selected a version, the mise-pinned global `vgpu`
already bundles its own docs offline - prefer bare `vgpu docs ...` over any download.
