```bash
ffmpeg -ss <seconds> -i <source-video> -frames:v 1 -y .media/generated/freeze-source.png
hyperframes remove-background .media/generated/freeze-source.png \
  -o .media/generated/freeze-cutout.png --json
hyperframes add freeze-frame-dressing --no-clipboard
```
