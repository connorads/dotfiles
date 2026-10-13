Then typecheck the app sources. In Vite apps, the root `tsc --noEmit` checks nothing because the root tsconfig only has project references:

```bash
pnpm exec tsc -p tsconfig.app.json --noEmit   # Vite.
pnpm exec tsc --noEmit                        # Next.js.
```

Fix generated files that fail strict checks (for example, an unused `React` import) before moving on, or `vite build` will fail.
