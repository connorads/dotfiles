`search` discovers web results and tools, `list` reveals a selected tool's contract, and `scrape <provider/capability> --options '<JSON>'` executes it. Inspect only the contracts needed for the task.

A client context/output error does not prove the provider failed. Keep the request/scrape ID and inspect saved output or use `scrape firecrawl/bash` against the retained result before repeating the request. See [large-result recovery](../firecrawl-scrape/references/large-results.md). Do not assume the client can signal an overflow back to the tool, or that Bash supports search IDs or every provider's retained data.

## When to Load References

- **Searching the web or finding sources first** -> [firecrawl-search](../firecrawl-search/SKILL.md)
- **Finding research papers (biomedical, clinical, or scientific literature; PubMed, bioRxiv, medRxiv, arXiv)** -> [firecrawl-research-index](../firecrawl-research-index/SKILL.md). Use the paper index instead of scraping PubMed or Google Scholar by hand; `search --categories research` is a website filter, not the paper index.
- **Answering a library, API, error, or known-bug question from issues, merged PRs, READMEs, or docs** -> [firecrawl-developer-index](../firecrawl-developer-index/SKILL.md)
- **Scraping a known URL** -> [firecrawl-scrape](../firecrawl-scrape/SKILL.md)
- **Scraping a list of known URLs as one job (batch scrape) or extracting JSON with a schema** -> [firecrawl-scrape](../firecrawl-scrape/SKILL.md)
- **Finding URLs on a known site** -> [firecrawl-map](../firecrawl-map/SKILL.md)
- **Bulk extraction from a docs section or site** -> [firecrawl-crawl](../firecrawl-crawl/SKILL.md)
- **AI-powered structured extraction from complex sites** -> [firecrawl-agent](../firecrawl-agent/SKILL.md)
- **Clicks, forms, login, pagination, or post-scrape browser actions** -> [firecrawl-interact](../firecrawl-interact/SKILL.md)
- **Downloading a site to local files** -> [firecrawl-download](../firecrawl-download/SKILL.md)
- **Parsing a local file (PDF, DOCX, XLSX, HTML, etc.)** -> [firecrawl-parse](../firecrawl-parse/SKILL.md)
- **Detecting content changes on a website and getting notified by webhook or email (pricing, jobs, posts, docs, status pages, anything ongoing)** -> [firecrawl-monitor](../firecrawl-monitor/SKILL.md)
- **Install, auth, or setup problems** -> [rules/install.md](rules/install.md)
- **Output handling and safe file-reading patterns** -> [rules/security.md](rules/security.md)
- **Integrating Firecrawl into an app, adding `FIRECRAWL_API_KEY` to `.env`, or choosing endpoint usage in product code** -> the [firecrawl-build skills](https://github.com/firecrawl/skills/tree/main/skills/build) (`firecrawl-build-onboarding`, `-scrape`, `-search`, `-interact`). They live in a separate repo and are **not** vendored here; do not run `firecrawl setup build`, which installs skills globally into every detected editor. <!-- LOCAL PATCH (connorads dotfiles): upstream moved a `firecrawl setup build` install directive into SKILL.md, outside the rules/install.md the firecrawl-mise patch covers; skills are vendored through the review flow, not installed at task time. -->
