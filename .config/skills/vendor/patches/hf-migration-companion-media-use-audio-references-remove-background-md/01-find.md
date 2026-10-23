
```bash
npx hyperframes remove-background subject.mp4 -o transparent.webm          # default: VP9 + alpha
npx hyperframes remove-background subject.mp4 -o transparent.mov           # ProRes 4444 (editing)
npx hyperframes remove-background portrait.jpg -o cutout.png               # single-image cutout
npx hyperframes remove-background subject.mp4 -o subject.webm \
  --background-output plate.webm                                           # both layers, one pass
npx hyperframes remove-background subject.mp4 -o transparent.webm --device cpu
npx hyperframes remove-background --info                                   # detected providers
```
