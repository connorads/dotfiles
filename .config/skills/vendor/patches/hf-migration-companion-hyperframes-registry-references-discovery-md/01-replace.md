
```bash
hyperframes catalog
hyperframes catalog --type block
hyperframes catalog --type component
hyperframes catalog --type block --tag social
hyperframes catalog --json
hyperframes catalog --human-friendly
```

- Default output is a readable table. It does not install anything.
- `--type` accepts `block` or `component`; `--tag` may narrow either result.
- `--json` is the deterministic agent and CI surface. Select a name, then run `hyperframes add <name>`.
- `--human-friendly` opens a picker and installs the selected item immediately.
