
```bash
npx hyperframes check                    # current directory: the full browser gate
npx hyperframes check ./my-project       # specific project
npx hyperframes check --json             # agent-readable envelope {ok, browserSkipped, lint, runtime, layout, motion, contrast, craft, hdr, snapshots}
npx hyperframes check --snapshots        # also write overview frames (annotated) + per-finding crops
npx hyperframes check --samples 15       # denser timeline sweep (default 9)
npx hyperframes check --at 1.5,4,7.25    # explicit hero-frame timestamps
npx hyperframes check --at-transitions   # also sample every tween start/end boundary
npx hyperframes check --tolerance 4      # allowed overflow px before reporting (default 2)
npx hyperframes check --timeout 30000    # initial render-ready + navigation minimum in ms (defaults: 3000 / 10000)
npx hyperframes check --no-contrast      # skip the WCAG audit while iterating
npx hyperframes check --strict           # exit non-zero on warnings too (default: only errors)
```
