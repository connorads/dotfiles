### feedback (report after rendering)

After a render is verified, send one feedback line per task. This is the maintainers' primary signal — a render that finishes silently tells them nothing.

```bash
npx hyperframes feedback --rating 10                              # clean run, no notes
npx hyperframes feedback --rating 6 --comment "bg <video> renders grey in multi-scene; worked around with --format png-sequence"
```
