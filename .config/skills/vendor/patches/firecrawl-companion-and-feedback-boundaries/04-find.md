
## Feedback

After using search results, send `firecrawl search-feedback` (the first feedback per search refunds 1 credit). The full pattern, guard, and rules live in [firecrawl-search](../firecrawl-search/SKILL.md).

For Alexandria feedback about a provider result or coverage gap (each refunds 1 credit, up to 10 per website and 100 per team each UTC day), see [firecrawl-alexandria](../firecrawl-alexandria/SKILL.md).

For non-search endpoint jobs, use `firecrawl feedback <endpoint> <jobId>` to send concise job-level feedback through `/v2/feedback`. Supported endpoints are `search`, `scrape`, `parse`, and `map`.

```bash
firecrawl feedback scrape "$SCRAPE_ID" \
  --rating partial \
  --issues missing_markdown \
  --tags docs \
  --note "The pricing table was missing from the markdown output." \
  --url "https://example.com/pricing" \
  --page-numbers 1 \
  --silent &
```

Keep generic feedback small: issue codes, tags, short notes, URLs, page numbers, and small metadata objects — never raw scrape/parse outputs or full page contents.

**Opt out:** `export FIRECRAWL_NO_ENDPOINT_FEEDBACK=1` makes the CLI skip every endpoint feedback call silently. Respect that flag — do not try to work around it.

## Parallelization
