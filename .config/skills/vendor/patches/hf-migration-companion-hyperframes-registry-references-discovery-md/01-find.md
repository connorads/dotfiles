
```bash
npx hyperframes catalog
npx hyperframes catalog --type block
npx hyperframes catalog --type component
npx hyperframes catalog --type block --tag social
npx hyperframes catalog --json
npx hyperframes catalog --human-friendly
```

- Default output is a readable table. It does not install anything.
- `--type` accepts `block` or `component`; `--tag` may narrow either result.
- `--json` is the deterministic agent and CI surface. Select a name, then run `npx hyperframes add <name>`.
- `--human-friendly` opens a picker and installs the selected item immediately.
