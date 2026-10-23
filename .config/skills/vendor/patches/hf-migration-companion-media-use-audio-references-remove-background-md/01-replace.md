
```bash
hyperframes remove-background subject.mp4 -o transparent.webm          # default: VP9 + alpha
hyperframes remove-background subject.mp4 -o transparent.mov           # ProRes 4444 (editing)
hyperframes remove-background portrait.jpg -o cutout.png               # single-image cutout
hyperframes remove-background subject.mp4 -o subject.webm \
  --background-output plate.webm                                           # both layers, one pass
hyperframes remove-background subject.mp4 -o transparent.webm --device cpu
hyperframes remove-background --info                                   # detected providers
```
