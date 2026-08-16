## Quick Setup (Recommended)

```bash
npx -y firecrawl-cli@latest init -y --browser
```

This installs `firecrawl-cli` globally, authenticates via browser, and installs core, build, and workflow skills.

This setup is safe to re-run when the CLI is missing, stale, or only partially configured.

If `firecrawl` is already installed and you want to update it first:

```bash
npm update -g firecrawl-cli
```

Skills are installed globally across all detected coding editors by default.

To install skills manually:

```bash
firecrawl setup skills
firecrawl setup workflows
```

## Manual Install

```bash
npm install -g firecrawl-cli@latest
```