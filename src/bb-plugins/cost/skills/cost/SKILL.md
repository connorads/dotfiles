---
name: cost
description: Check agent usage at API prices, backfill usage history, or refresh model prices with the Cost plugin.
---

# Cost

The Cost plugin estimates what Claude Code, Codex and Pi requests would cost at API list prices.
Figures are estimates for subscription users, not bills.

- `bb cost backfill` reads every session log on every active host. It runs in the background and is safe to repeat.
- `bb cost status` shows backfill progress, ledger size, price-file age and the last 30 days' total.
- `bb cost prices` downloads the LiteLLM price file now. The plugin also refreshes it every six hours.

Add `--json` for machine-readable output.
The `claudeConfigDirs` setting adds Claude Code config directories that no BB thread uses.
The `plans` setting lists subscription prices, one `Name = monthly dollars` per line.
