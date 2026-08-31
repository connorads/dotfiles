## Open parameters

{{marker}}

Omit `--browser` unless that browser's own behaviour is what you are testing. The
configured default (`~/.playwright/cli.config.json`) is bundled Chromium.
`--browser=chrome` and `--browser=msedge` drive the *system* Chrome/Edge app and take
over the user's own browser windows.

```bash
# Name a browser only when that browser's behaviour is under test
playwright-cli open --browser=firefox
playwright-cli open --browser=webkit
playwright-cli open --browser=chrome   # system Chrome, not a throwaway profile
playwright-cli open --browser=msedge   # system Edge, not a throwaway profile
