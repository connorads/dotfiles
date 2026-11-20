| `eas observe:metrics-summary` | Per-version statistical aggregates for startup and navigation metrics (median, p90, etc.) |
| `eas observe:metrics` | Individual metric samples ordered by value or timestamp (paginated) |
| `eas observe:routes` | Per-route statistical aggregates for navigation metrics (Nav Cold TTR, Nav Warm TTR, Nav TTI) |
| `eas observe:events` | Custom events emitted by the app via `logEvent` — name summary, all events, or filtered by event name (paginated) |
| `eas observe:session` | Full timeline of metric and log events for one session |
| `eas observe:versions` | App version hierarchy with build numbers, OTA update IDs, and event counts |
| `eas observe:errors` | Error groups by fingerprint; `--fingerprint <id>` lists one group's occurrences with stack traces |
| `eas observe:event` | One metric, log, or error event by its ID, taken from the `--json` output of `observe:session`, `observe:metrics`, or `observe:events`, or from the occurrences listed by `observe:errors --fingerprint` |
