
```bash
npx hyperframes capture https://stripe.com                  # scaffold from a website
npx hyperframes capture https://linear.app -o linear-video  # custom output directory
npx hyperframes capture https://example.com --json          # JSON output for agents
npx hyperframes capture https://example.com --skip-assets   # skip image/SVG download
npx hyperframes capture https://example.com --skip-vision   # skip optional AI captions
npx hyperframes capture https://example.com --max-screenshots 12
npx hyperframes capture https://example.com --timeout 60000 # page-load timeout in ms
npx hyperframes capture https://example.com --capture-budget 90000 # post-navigation budget
```
