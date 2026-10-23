
```bash
hyperframes check --snapshots               # reports a finding, e.g. content_overlap on "#cta"
hyperframes snapshot --zoom "#cta"           # crop the element to verify the defect, at 3x density
hyperframes snapshot --zoom "100,50,400,300" --zoom-scale 2   # or an exact pixel region
# fix the composition HTML, then re-check:
hyperframes check
```
