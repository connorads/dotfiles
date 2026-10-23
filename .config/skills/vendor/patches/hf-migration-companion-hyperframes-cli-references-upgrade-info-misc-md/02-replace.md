
```bash
TL=$(hyperframes timeline --json)
# 1. what plays at absolute time T=12.5
jq --argjson t 12.5 '[.timeline.tracks[].rows[] | select(.absStart<=$t and .absEnd>$t)]' <<<"$TL"
