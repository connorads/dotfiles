
```bash
npx hyperframes check --snapshots               # reports a finding, e.g. content_overlap on "#cta"
npx hyperframes snapshot --zoom "#cta"           # crop the element to verify the defect, at 3x density
npx hyperframes snapshot --zoom "100,50,400,300" --zoom-scale 2   # or an exact pixel region
# fix the composition HTML, then re-check:
npx hyperframes check
```
