## Browser Session Commands

{{marker}}

```bash
# List all browser sessions
playwright-cli list

# Stop a browser session (close the browser) - prefer this
playwright-cli close                # stop the default browser
playwright-cli -s=mysession close   # stop a named browser

# Stop every session in this workspace. The workspace root here is $HOME, so this
# includes sessions other agents own. Check `playwright-cli list` first.
playwright-cli close-all
