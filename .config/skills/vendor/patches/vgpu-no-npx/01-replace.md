{{marker}}

```sh
vgpu docs find <query>    # search doc paths + symbols
vgpu docs grep -i <term>  # search doc CONTENT
vgpu docs cat <symbol>    # print one doc, e.g. `cat Frame`, `cat performance-model`
```

`vgpu` is the mise-pinned global CLI here, and it serves the docs bundled into its own
version, offline. Read every `npx vgpu` in `references/` as `vgpu`. Inside a repo that
depends on vgpu, use `pnpm exec vgpu` instead for docs matching that project's version.
