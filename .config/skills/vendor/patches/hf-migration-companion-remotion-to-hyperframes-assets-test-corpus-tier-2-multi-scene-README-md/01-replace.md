
# 2. Render Remotion baseline
cd remotion-src && pnpm add && pnpm render

# 3. Render HyperFrames translation
cd ../hf-src && hyperframes render --output ../hf.mp4

# 4. Compare
