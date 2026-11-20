# Opaque interval that replaces native video beneath it
bunx remotion render <entry> <composition> fallback.mov \
  --frames=S-E --codec=prores --prores-profile=light \
  --pixel-format=yuv422p10le --image-format=png --muted

# Transparent overlay; only use an entry/composition that truly isolates the layer
bunx remotion render <entry> <overlay-composition> overlay.mov \
  --frames=S-E --codec=prores --prores-profile=4444 \
  --pixel-format=yuva444p10le --image-format=png --muted

# Audio stem that replaces all audio included in the render
bunx remotion render <entry> <composition> stem.wav \
  --frames=S-E --codec=wav
