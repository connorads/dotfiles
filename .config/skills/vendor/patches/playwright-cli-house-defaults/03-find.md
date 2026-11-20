# Connect to the browser profile of the user via Playwright Extension (chrome, msedge, ...).
# The session name is the title of the tab group; pick a color to tell sessions apart.
playwright-cli attach --extension=chrome --session=finance --session-color=blue
playwright-cli -s=finance goto https://example.com
# Detach and close the tabs of the session, when the user does not need them
playwright-cli -s=finance detach --close-tabs

# Connect to a running Chrome or Edge by channel name
playwright-cli attach --cdp=chrome
playwright-cli attach --cdp=msedge
