
- `npx hyperframes capture <url> --json` writes `screenshots/full-page.png`: a 1x plate of the whole page, taken after the scroll pass with sticky and fixed elements made static, pixel-exact for a 1920-wide viewport travelling down it. It is skipped above 16384 px tall (use `scroll-*.png`); pushing in past 1:1 needs its own 2x capture of that region.
- To show the site as it is, use its screenshots. Rebuilding the page in HTML drifts from the real layout; rebuild only the part that moves, or overlay captured assets at measured positions.
