{{marker}}

MCP servers are managed with `mcpz` here, from a gitignored registry at `~/.config/mcp/`.
Do not run `add-mcp`: it detects every installed MCP client and writes global config into
all of them. Ask before adding a bundle. The hosted VGPU server is read-only docs and
examples, so it is largely redundant with the docs the mise-pinned `vgpu` CLI already
bundles. No VGPU account or authorization flow is required.
