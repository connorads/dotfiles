```bash
# Render Remotion baseline (no setup.sh — no binary assets in this fixture)
cd remotion-src && npm install && npm run render

# Render HyperFrames translation
cd ../hf-src && npx hyperframes render --output ../hf.mp4

# Compare
