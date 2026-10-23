
```bash
hyperframes info                   # project metadata
hyperframes info ./my-video        # specific project
hyperframes info --json
```

Prints **project** metadata: name, resolution, duration, element counts by type, track count, and total project size. Project-level — not environment. For environment health use `doctor`.

## Tool maintenance

Do not upgrade the CLI or rewrite project package scripts during video work. Provision updates through the local tool workflow.

## timeline

```bash
hyperframes timeline [project-dir]          # tracks and clips as a table with bars
hyperframes timeline [project-dir] --json
```
