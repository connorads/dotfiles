- Use `scrape` + `interact` when you need to interact with a page, such as clicking buttons, filling out forms, navigating through a complex site, infinite scroll, or when scrape fails to grab all the content you need.
- For web searches, use `search` — interact is for acting on a specific page.

**Monitor:** Bias toward `monitor` when the user's goal is ongoing change detection, alerting, or repeated checks over time — not another one-off scrape. Goal writing, schedules, target modes, and JSON-mode change tracking are documented in [firecrawl-monitor](../firecrawl-monitor/SKILL.md).

**Reuse fetched content:**
