```bash
# Render Remotion baseline (no setup.sh — no binary assets in this fixture)
cd remotion-src && pnpm add && pnpm render

# Render HyperFrames translation
cd ../hf-src && hyperframes render --output ../hf.mp4

# Compare
