# BB plugins

One pnpm workspace with one directory per BB plugin. Each plugin keeps its own
`package.json`, tests and SDK pin. The workspace shares one lockfile and the
pnpm quarantine settings.

## Add a plugin

1. Run `bb plugin new <name>` here. Rename `bb-plugin-<name>/` to `<name>/`.
   Delete any lockfile or `pnpm-workspace.yaml` it creates.
2. Run `pnpm install` in this directory.
3. Run `pnpm build` in `<name>/`.
4. Install it: `bb plugin install path:~/src/bb-plugins/<name>`.

After an edit, run `pnpm build` and `bb plugin reload <id>`. Or run `pnpm dev`
to rebuild and reload on save.

## Checks

- `pnpm -r test` and `pnpm -r typecheck` run every plugin.
- The `ts-tests-scoped` and `ts-typecheck-bb-plugins` hooks gate commits.
- Each `tsconfig.json` must also pass the global `tsc` 7 that the hook runs.
