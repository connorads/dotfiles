```bash
# Render Remotion baseline
cd remotion-src && pnpm install && pnpm render
# Renders to remotion-src/out/baseline.mp4

# Render HyperFrames translation
cd ../hf-src && hyperframes render --output ../hf.mp4

# Compare with the HF CLI
hyperframes diff ../remotion-src/out/baseline.mp4 ../hf.mp4 --out ../diff
```
