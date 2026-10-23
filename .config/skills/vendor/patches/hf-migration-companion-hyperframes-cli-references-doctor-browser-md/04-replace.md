
```bash
hyperframes doctor --json | jq -e \
  '[.checks[] | select(.name == "FFmpeg" or .name == "FFprobe")] | length == 2 and all(.ok)'
```
