```bash
# Background music
npx hyperframes media-use resolve --type bgm --intent "upbeat tech launch" --project .
# → resolved bgm_001 → .media/audio/bgm/bgm_001.mp3 (bgm, 25s)

# Sound effect
npx hyperframes media-use resolve --type sfx --intent "whoosh" --project .
# → resolved sfx_001 → .media/audio/sfx/sfx_001.mp3 (sfx, 0.57s)

# Image
npx hyperframes media-use resolve --type image --intent "gradient tech background" --project .
# → resolved image_001 → .media/images/image_001.jpg (image)

# Icon
npx hyperframes media-use resolve --type icon --intent "rocket" --project .
# → resolved icon_001 → .media/images/icon_001.png (icon, transparent)

# Brand logo (official mark — never redrawn by hand)
npx hyperframes media-use resolve --type logo --entity linkedin --intent "LinkedIn logo" --project .
# → resolved logo_001 → .media/images/logo_001.svg (logo, official mark)

# Color grade block
npx hyperframes media-use resolve --type grade --intent "warm daylight" --project . --json
# → {"ok":true,"preset":"warm-daylight","grading":{"preset":"warm-daylight","intensity":1},...}

# LUT file
npx hyperframes media-use resolve --type lut --intent "teal orange blockbuster" --project .
# → resolved lut_001 → .media/luts/lut_001.cube (lut)
```
