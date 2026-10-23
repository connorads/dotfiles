| Symptom | Fix |
| --- | --- |
| Chrome missing or won't start | `npx hyperframes browser ensure`; `doctor --json` always exits 0, gate on `.ok` |
| A heavy page isn't ready in time | Raise `--timeout` on `check` or `snapshot` |
| Unusual codec looks blank | Keep `--proxy` on (the default) |
