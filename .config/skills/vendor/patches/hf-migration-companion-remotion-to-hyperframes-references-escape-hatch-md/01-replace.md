> implementation. Quick summary:
>
> 1. Bundle `entry.tsx` with esbuild: `pnpm exec esbuild entry.tsx --bundle --outfile=dist/bundle.js --format=iife --jsx=automatic`
> 2. Mount the Player and register on `window.__hfRemotion`:
>
