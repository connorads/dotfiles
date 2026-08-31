# Connect to browser via Playwright Extension - drives the user's own Chrome
playwright-cli attach --extension=chrome

# Connect to a running Chrome or Edge by channel name. `attach` takes over the
# user's real browser windows and ignores the configured browser, so use it only
# when that browser's own state or behaviour is what you need.
playwright-cli attach --cdp=chrome
playwright-cli attach --cdp=msedge
