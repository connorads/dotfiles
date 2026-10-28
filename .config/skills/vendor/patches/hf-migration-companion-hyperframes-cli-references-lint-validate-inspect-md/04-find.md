
```bash
npx hyperframes snapshot                       # 5 key frames as PNG
npx hyperframes snapshot ./my-project          # specific project
npx hyperframes snapshot --frames 10           # evenly-spaced N frames
npx hyperframes snapshot --range 3,5 --frames 8 # 8 frames within root-timeline seconds 3–5
npx hyperframes snapshot --composition intro --frames 8 # 8 frames within this data-composition-id
npx hyperframes snapshot --review              # beat sheet, seam strips, phone sheet
npx hyperframes snapshot --review --json       # same, with paths and times as JSON
```
