| `npx --yes eas-cli@latest observe:metrics-summary` | Per-version statistical aggregates for startup and navigation metrics (median, p90, etc.) |
| `npx --yes eas-cli@latest observe:metrics` | Individual metric samples ordered by value or timestamp (paginated) |
| `npx --yes eas-cli@latest observe:routes` | Per-route statistical aggregates for navigation metrics (Nav Cold TTR, Nav Warm TTR, Nav TTI) |
| `npx --yes eas-cli@latest observe:events` | Custom events emitted by the app via `logEvent` — name summary, all events, or filtered by event name (paginated) |
| `npx --yes eas-cli@latest observe:session` | Full timeline of metric and log events for one session |
| `npx --yes eas-cli@latest observe:versions` | App version hierarchy with build numbers, OTA update IDs, and event counts |
| `npx --yes eas-cli@latest observe:errors` | Error groups by fingerprint; `--fingerprint <id>` lists one group's occurrences with stack traces |
| `npx --yes eas-cli@latest observe:event` | One metric, log, or error event by its ID, taken from the `--json` output of `observe:session`, `observe:metrics`, or `observe:events`, or from the occurrences listed by `observe:errors --fingerprint` |
