---
name: single-html-page
description: >-
  Bundles an HTML page or URL into one self-contained, shareable HTML file by
  embedding images, icons, CSS, JavaScript, fonts, and other page assets as data
  URIs. Use when the user asks to make a webpage portable, offline, standalone,
  single-file, self-contained, shareable, or not depend on an assets folder.
  Not for rebuilding or redesigning the page.
---

# Single HTML Page

Create one HTML file that can be shared without its original asset folder or
live network dependencies.

## Default Path

Use `scripts/single_html_page.py` (EXECUTE) unless the user asks to do the
bundling manually:

```bash
python3 scripts/single_html_page.py input.html
python3 scripts/single_html_page.py https://example.com/page --output page-shareable.html
```

The script wraps `monolith`, removes leftover network hint and `base` links,
and verifies that asset-bearing references are embedded as data URIs.

## Tool Choice

Prefer `monolith` from `PATH`. It is the primary bundler because it embeds
linked CSS, images, JavaScript, and fonts into one HTML document. If `monolith`
is missing, check the local tool manager first (`nix`/home-manager or `mise`)
instead of installing an ad hoc replacement.

For local HTML files, the script sets the base URL to the file's directory so
relative assets resolve correctly. For URLs, the script lets `monolith` fetch
the page and its assets directly.

## Workflow

1. Run the script and write `*-shareable.html` unless the user names an output.
2. Read the script's verification summary. If it reports remaining asset refs,
   inspect and either fix them or tell the user what still depends on network or
   local files.
3. For user-facing pages, render at least one screenshot. Use desktop and
   mobile screenshots when responsive layout matters.
4. Preserve page content and behaviour. This skill packages the page; it does
   not restyle, rewrite, or redesign it.

## Verification

Accept external links in normal anchors, but do not accept asset-bearing
references such as `img src`, `script src`, stylesheet/icon `link href`,
`srcset`, CSS `url(...)`, or `@import` unless they are `data:` or fragment
references.

If the page relies on JavaScript-rendered DOM that is not present in the source
HTML, render or dump the browser DOM first, then run the bundler on that HTML
with the original page URL as the base URL.

`monolith -I` isolates the document from the Internet, so a page that fetches at
runtime (JS `fetch`/XHR, SPA data loads) will not work offline. Asset-ref
verification cannot detect this, so rely on the step 3 screenshot to catch it.

The CSS `url(...)`/`@import` check scans the whole document, so a `url(...)`
literal inside a `<script>` body or attribute string can surface as a false
positive; inspect flagged references rather than trusting the exit code alone.
