Use `add-mcp` to detect installed MCP clients and add the hosted VGPU server globally:

```terminal
npx -y add-mcp https://vgpu.sh/api/mcp -g
```

Remove `-g` to configure clients for the current project instead. The installer lets you review its detected clients before writing their configuration. No VGPU account or authorization flow is required.
