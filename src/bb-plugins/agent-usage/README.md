# Agent usage for BB

Show the limit most likely to stop the current thread in its header. Open an
account usage overlay with `⌘⇧A`. Press `Q` or `Esc`, click outside, or click
Close to dismiss it. The shortcut is rebindable under **Agent usage: show all
accounts** in BB's keyboard settings. Clicking the header badge opens the same overlay.

## Pace

Each timed window compares use with even spending across the window. The bar's
marker shows where steady use would be by now. Fill past the marker means the
window is being used faster than it refills.

| Status | Meaning |
| --- | --- |
| Under pace / On pace | Use is more than 5 points below, or within 5 points of, even spending |
| Ahead of pace | Use is more than 5 points above even spending, under 1.2× |
| Runs out HH:MM | At 1.2× even spending or faster; the time assumes the rate so far continues |
| Limit reached | The window is full until its reset |
| Reset since last check | The reading predates its reset, so no percentage is shown |

Amber marks 1.2× pace or 70% used. Red marks 1.4× pace, 90% used or a full window.
Projections wait for 10 minutes or 5% of the window, whichever is longer.
Windows are 5-hour, daily, weekly or monthly (one calendar month before the reset).
Allowances with a dollar limit show as credits with their expiry and have no pace.

## Overlay

The overlay opens with one sentence on the worst window across all accounts. When
an account needs attention, it names the same provider's account with the most room.
Accounts are grouped by provider, and by machine when more than one reports.
**Refresh** requests fresh measurements. A failed refresh keeps previous figures
and reports the failure. Missing measurements appear as unavailable.

The default Claude profile reads the same login as BB's native Claude source.
The overlay shows it once, as **Default**, with the native plan and email and any
windows only the profile reports.

## Header

The header follows the thread's provider and host. Claude threads with the
Claude Profiles plugin use their selected profile. The badge shows the binding
window: the worst tone first, then the highest use. A ring shows its use. The
text adds the run-out or reset time when the window needs attention. The badge
refreshes when thread state changes, when the window gains focus, and every two
minutes. Hover over it for every window.

```mermaid
flowchart LR
    Header[Thread quota badge] --> Popup[Usage overlay]
    Shortcut[Keyboard shortcut] --> Popup
    Popup --> Collector[BB Provider usage cache]
    Header --> Collector
    Header --> Profiles[Selected Claude profile cache]
```

Enable BB's built-in **Provider usage** plugin. Its sources supply the available
providers and accounts. Agent usage delegates collection to that plugin and
Claude Profiles. It does not read credentials or create accounts.

## CLI and SDK

```sh
bb agent-usage
bb agent-usage --refresh
bb agent-usage --thread THREAD_ID
```

The plugin publishes the `overview` and `header` RPC methods through
[rpcContract](contracts.ts). Call them with `bb.sdk.plugins.callRpc` using
`pluginId: 'agent-usage'`. `overview` takes `{ refresh: boolean }`;
`header` takes `{ threadId: string }`. Every window carries a normalised `label`
(`5-hour`, `Weekly`, `Weekly · Fable`, `Credits`) and its `period`
(`five-hour`, `day`, `week`, `month` or `null`).

## Development

```sh
pnpm test
pnpm typecheck
pnpm build
bb plugin reload agent-usage
```

Install with `bb plugin install path:~/src/bb-plugins/agent-usage`.
The shared pnpm workspace owns dependencies and its lockfile.
The `components`, `hooks` and `lib` directories contain BB-scaffolded responsive
UI primitives. Compact layouts use BB's persistent responsive drawer.
