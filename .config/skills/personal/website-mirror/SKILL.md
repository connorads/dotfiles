---
name: website-mirror
description: >-
  Picks the right local tool and command to mirror, archive, or snapshot a
  website or page for offline use, and avoids the silent failure where a saved
  page renders blank with no network. Use when asked to mirror, archive,
  download, save, or snapshot a site or page for offline viewing, make a
  browseable offline copy, or grab a page as a single self-contained file -
  covering wget, monolith, firecrawl and yt-dlp, robots and soft-block
  handling, and the JS/API offline-content trap. Not for live web extraction
  into markdown when no local copy is wanted - use firecrawl directly for that.
---

# Website Mirror

One question decides everything:

> **Will the bytes I save still contain the content with no network?**

Mirroring fails silently when content is fetched at view-time. Answer that
first, then pick a tool.

## Answer it: where does the content live?

`curl -sL <url>` (or view-source) and grep for text you can see on the page:

- **In the HTML** → any tool works (static site).
- **Rendered by JS from data already inline** (`var data=[…]`, `__NEXT_DATA__`)
  → works offline *if the saved file keeps its scripts* (monolith and wget do).
- **Fetched from an API at runtime** (`fetch('/api/…')`, infinite scroll) →
  the saved page renders blank offline. Resolve the API and bake the data in,
  or capture already-rendered HTML with firecrawl.

## Pick the tool

Local set on this machine (`command -v` to confirm elsewhere): wget, monolith,
firecrawl, yt-dlp.

| Goal | Tool | Command |
|---|---|---|
| Whole static site, browseable offline | wget | `wget --mirror --convert-links --adjust-extension --page-requisites --no-parent --wait=1 --random-wait <url>` |
| One page → single self-contained file | monolith | `monolith <url> -o page.html` |
| JS/API content, or rendered HTML → markdown | firecrawl | `firecrawl scrape <url>` / `firecrawl crawl <url>` (also firecrawl MCP) |
| Video / audio from a page | yt-dlp | `yt-dlp <url>` |

- **monolith crawls nothing** - one page only. It inlines CSS/JS/images but
  leaves cross-domain refs (analytics, Turnstile, social buttons) external by
  design, so those die offline - not a mirror bug.
- wget's `--mirror` = `-r -N -l inf`; the `-k -E -p` flags are what make the
  copy actually browseable offline (converted links, `.html` extensions, page
  requisites). Bare `wget -r` gives broken links and missing assets.

## robots and blocks - respect them

- wget honours `robots.txt` by default and will **silently mirror nothing** on
  a `Disallow`. `-e robots=off` overrides it - a deliberate choice, not a
  default. A blanket `User-agent: * / Disallow: /` (e.g. IMDb) means the site
  is off-limits to generic clients; use its licensed or official data route,
  don't evade access controls.
- **Soft-block tell:** HTTP 200 or 202 with a 0-byte body is bot mitigation, not
  success. A naive `http_code < 400` check treats it as a win and ships an empty
  dataset - check `size_download` / actual bytes.

## Be gentle

`--wait=1 --random-wait`, serial not aggressively parallel. The delay is the
courtesy, not an afterthought.

## Verify offline (don't re-fetch)

Inspect the saved files only: grep for real content, and confirm converted
links point at local files that exist. Re-fetching during verification hides
exactly the gap you are checking for.
