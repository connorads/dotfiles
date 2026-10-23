```bash
# Open preview in an isolated Chromium profile
hyperframes preview --background --browser-path /usr/bin/chromium --user-data-dir /tmp/hf-profile

# Same plus a CDP endpoint on :9222 (attach DevTools / Playwright / etc.)
hyperframes play --browser-path /usr/bin/chromium --user-data-dir /tmp/hf-profile --remote-debugging-port 9222
```
