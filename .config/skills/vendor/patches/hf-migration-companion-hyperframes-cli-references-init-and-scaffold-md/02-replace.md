
```bash
hyperframes capture https://stripe.com                  # scaffold from a website
hyperframes capture https://linear.app -o linear-video  # custom output directory
hyperframes capture https://example.com --json          # JSON output for agents
hyperframes capture https://example.com --skip-assets   # skip image/SVG download
hyperframes capture https://example.com --skip-vision   # skip optional AI captions
hyperframes capture https://example.com --max-screenshots 12
hyperframes capture https://example.com --timeout 60000 # page-load timeout in ms
hyperframes capture https://example.com --capture-budget 90000 # post-navigation budget
```
