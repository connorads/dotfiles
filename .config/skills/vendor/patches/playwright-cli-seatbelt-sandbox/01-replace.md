```

## macOS Seatbelt sandbox

{{marker}}

Inside the macOS Seatbelt agent sandbox, `playwright-cli` cannot start. These errors identify it:

- `listen EPERM ... browser-*.sock`: the daemon cannot bind its Unix socket.
- `bootstrap_check_in ... Permission denied (1100)`: Chromium cannot register the Mach service its child processes need.
- `Target page, context or browser has been closed` straight after launch.

Config changes do not fix this. Write a Playwright script instead, with `playwright` from the project or the mise `npm:playwright` install:

```js
import { chromium } from 'playwright';

const proxyUrl = process.env.HTTPS_PROXY && new URL(process.env.HTTPS_PROXY);
const browser = await chromium.launch({
  args: ['--single-process'],
  proxy: proxyUrl && {
    server: `http://${proxyUrl.host}`,
    username: decodeURIComponent(proxyUrl.username),
    password: decodeURIComponent(proxyUrl.password),
  },
});
const context = await browser.newContext(); // one context per browser
const page = await context.newPage();       // more tabs: context.newPage()
await page.goto(process.argv[2]);
await page.screenshot({ path: 'shot.png' });
await browser.close();
```

- Create one context. A second `newContext()` or `browser.newPage()` kills the browser.
- Do not pass `--enable-gpu`. The sandbox has no GPU access, so single-process launch crashes.
- Pass the proxy explicitly. Chromium ignores `HTTPS_PROXY` and credentials inside a proxy URL. The sandbox domain allowlist still applies.
- Only the default headless shell works. `--headed`, `--browser`, `channel` and full Chromium need the denied Unix socket.
- Single-process mode has no site isolation, and one renderer crash ends the browser. Use it for local pages and trusted sites.

For the CLI, headed mode, WebGL at GPU speed or untrusted sites, run outside the sandbox.

## Example: Form submission
