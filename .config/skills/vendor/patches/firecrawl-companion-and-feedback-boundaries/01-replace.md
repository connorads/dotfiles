
<!-- LOCAL PATCH (connorads dotfiles): upstream widened this skill to claim any web task and deleted its own "do NOT trigger for local file operations, git commands, deployments, or code editing" guard; native web tools stay the default for plain search and page reads. --> Reach for Firecrawl when the task needs what it uniquely does: scraping a specific URL, crawling or mapping a site, bulk or structured extraction, downloading a site, interacting with a page (clicks, forms, pagination, login), or monitoring pages for changes. For ordinary web search and reading a page, prefer the runtime's own web tools. Do NOT trigger for local file operations, git commands, deployments, or code editing tasks.

For structured datasets, first check for a suitable workflow or data provider using the `search skill`. Read a known page directly; reuse a selected contract instead of repeating discovery.

Follow this escalation pattern:
