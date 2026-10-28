
```bash
hyperframes snapshot                       # 5 key frames as PNG
hyperframes snapshot ./my-project          # specific project
hyperframes snapshot --frames 10           # evenly-spaced N frames
hyperframes snapshot --range 3,5 --frames 8 # 8 frames within root-timeline seconds 3–5
hyperframes snapshot --composition intro --frames 8 # 8 frames within this data-composition-id
hyperframes snapshot --review              # beat sheet, seam strips, phone sheet
hyperframes snapshot --review --json       # same, with paths and times as JSON
```
