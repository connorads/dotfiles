```bash
npx hyperframes info                   # project metadata
npx hyperframes info ./my-video        # specific project
npx hyperframes info --json
```

Prints **project** metadata: name, resolution, duration, element counts by type, track count, and total project size. Project-level — not environment. For environment health use `doctor`.

## upgrade

```bash
npx hyperframes upgrade                # check + interactive prompt
npx hyperframes upgrade --check        # check and exit, no prompt (agent-friendly)
npx hyperframes upgrade --check --json # machine-readable: current / latest / updateAvailable
npx hyperframes upgrade --yes          # print upgrade commands without prompting
```

Compares the installed CLI version against npm latest.

`--project [dir]` bumps a **project's** pinned scripts instead of the global install: it rewrites every `npx …hyperframes@<version>…` in `<dir>/package.json` (default cwd) to npm-latest. With standalone skills, use `node "<SKILLS>/hyperframes/scripts/plugin-cli.mjs" --cli-version latest upgrade --project .`. In a plugin, keep using its bundled CLI. `--project . --check` reports the delta without writing; add `--json` for `{ changed, from, to, path }`. Pass the dir explicitly whenever another flag follows `--project` — on older releases a bare `--project` consumes the next flag as its directory value.

## timeline

```bash
npx hyperframes timeline [project-dir]          # tracks and clips as a table with bars
npx hyperframes timeline [project-dir] --json
```
