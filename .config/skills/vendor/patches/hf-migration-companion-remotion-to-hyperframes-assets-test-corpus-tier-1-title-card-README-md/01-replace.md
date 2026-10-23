```bash
# Render Remotion baseline
cd remotion-src && pnpm add && pnpm render
# Renders to remotion-src/out/baseline.mp4

# Render HyperFrames translation
cd ../hf-src && hyperframes render --output ../hf.mp4

# Compare with the eval harness (from skill scripts/)
