# Technical SEO and crawler access

Labels: **official** (the owner's docs), **experiment** (run and observed), **correlation**,
**practitioner**, **contested**. `vf:<id>` marks a perishable fact. Before you state it,
check its row in `references/volatile-facts.md`. Source keys in `[brackets]` resolve at the
end of this file.

## Contents

1. Reading the probe
2. Bots, robots.txt and the WAF
3. Rendering fixes by stack
4. Next.js App Router and Vercel
5. Indexing
6. Discovery writes
7. Migrations
8. Schema
9. Logs

## 1. Reading the probe

Re-check = rerun the same `scripts/probe.py` command. Add `--base http://127.0.0.1:PORT`
for a local build. A flag counts as fixed only when it is gone from that rerun.
`EMPTY_BODY` exits 2: report the fetch as failed, never as a clean page.

### Access flags (gate 1 Fetched, unless noted)

| Flag | Means | Usual cause -> fix | Do not claim |
|---|---|---|---|
| `STATUS_x` | Final status is x, not 200 | 403/429: WAF or bot rule (section 2). 5xx: origin. 404: route missing | "The real bot is blocked" from a 403 under a spoofed UA |
| `REDIRECT_CHAIN` | 2+ hops to the final URL | http -> www -> apex chains. Redirect each variant to the final URL in one hop | "Lost ranking" (Google follows chains; it is latency and crawl waste) |
| `NOINDEX` | `<meta name="robots">` holds noindex | Template or env flag left on. Remove it server-side | "Removed with JS is fine": Google may skip JS on noindex pages [g-js] |
| `X_ROBOTS_NOINDEX` | `X-Robots-Tag: noindex` header | Host or platform header (Vercel previews, section 4) | That the page HTML is at fault |
| `NO_TITLE` | No `<title>` in raw HTML | Client-set title (`document.title`). Render it on the server | - |
| `TITLE_IN_BODY` | `<title>` sits after `<head>` closes | Next.js streamed metadata (section 4) | "Googlebot misses it": Next.js treats Googlebot as a JS-running bot [next-isbot]. Non-JS AI fetchers are the risk |
| `NO_H1_RAW` | No h1 before JS | SPA shell or client-only component | - |
| `MULTIPLE_CANONICALS` | 2+ `rel=canonical` | Layout and page both emit one. Keep one per page | Which one Google picked: only GSC URL Inspection shows that |
| `CANONICAL_ELSEWHERE` | Canonical points to another URL | Root-layout canonical inherited by every page (section 4), or a real duplicate | A fault when the page is a deliberate duplicate |
| `HTML_OVER_2MB` | Raw HTML over 2 MB | Inlined data URIs, huge JSON payloads. Googlebot reads only the first 2 MB of a file [g-googlebot] vf:googlebot-fetch-limit | That content after 2 MB is indexed |
| `THIN_RAW_HTML` | Few body words before JS | Client-side rendering (section 3) | "Thin content" in the quality sense. It is a rendering fault |
| `EMPTY_BODY` | Body under 512 B; exit 2 | Fetch failed, challenge page, or empty shell | Any pass or zero count from this URL |
| `UA_DIFFERS` | Bot UA and browser UA get different status or body | WAF rule on the UA, or IP-verified bot gating | "Cloaking" or "the real bot is blocked". It is `UNRESOLVED` until logs or IP checks settle it (section 2) |
| `SOFT_404_HOST` | A random path returns 200 directly (redirects ignored) | SPA catch-all serves the shell for every path. Serve a real 404 | "A penalty". It wastes crawl and multiplies self-canonical junk URLs |

### Render flags (need `--render`; gate 1)

| Flag | Means | Usual cause -> fix | Do not claim |
|---|---|---|---|
| `JS_DEPENDENT_CONTENT` | Rendered DOM has far more words than raw | Client rendering. Prerender or SSR the route | That Google cannot index it. Google renders JS; many AI crawlers do not |
| `H1_ONLY_AFTER_JS` | h1 exists only after JS | Same | - |
| `CANONICAL_CHANGES_WITH_JS` | Raw and rendered canonicals differ | Client router or head manager rewrites it. Emit the final canonical server-side | Which value Google uses |
| `JSONLD_ONLY_AFTER_JS` | JSON-LD appears only after JS | Tag manager or client component injects it. Emit it in server HTML | "No schema". It exists; non-JS fetchers miss it |
| `RENDER_FAILED` | Chrome render failed or timed out | No Chrome (`SKIPPED`), or the page never settles | Any render finding for this URL |

### Robots flags (need `--robots` or `--robots-file`; gate 1)

| Flag | Means | Usual cause -> fix | Do not claim |
|---|---|---|---|
| `ROBOTS_HTML` | /robots.txt returns HTML | SPA catch-all. Serve a real text file before the catch-all | That bots are blocked. An HTML body has no valid rules, so it likely acts as "allow all" with no `Sitemap:` line (inference) |
| `ROBOTS_CONTENT_TYPE` | Not `text/plain` | Framework default. Set the header | A blocking fault on its own |
| `ROBOTS_5XX` | 5xx (or 429) for robots.txt | Origin or WAF. Google pauses crawling for 12 hours, then uses the last good copy for 30 days [g-robots] | "No effect": crawling stops |
| `ROBOTS_TOO_LARGE` | Over 500 KiB | Generated rules. Google ignores content past 500 KiB [g-robots] | - |
| `SEARCH_BOT_BLOCKED:<token>` | A search or user-fetch token is disallowed for a probed path | Legacy blanket rule, or a named group that drops `*` rules | That the bot obeys it. User-fetch agents may ignore robots.txt (section 2) |

### Schema flags (gate 2 or hygiene; section 8 holds the rules)

| Flag | Means | Fix | Do not claim |
|---|---|---|---|
| `JSONLD_PARSE_ERROR` | A block is not valid JSON | Fix syntax; trailing commas and unescaped quotes are usual | "No schema" |
| `NONE_IN_RAW` | No JSON-LD in raw HTML, after `@graph` and `@id` resolution | Add Organization and WebSite in the root layout | "No schema" when `JSONLD_ONLY_AFTER_JS` is also set |
| `PLACEHOLDER_VALUE` | Values like `[Phone]`, `TODO`, `example.com`, `000-0000` | Real values or drop the property | - |
| `SELF_SERVING_RATING` | `aggregateRating`/`review` on the site's own Organization or LocalBusiness, or ratings copied from another site | Remove it; show real reviews as visible text [g-review] | That stars will appear |
| `NO_RICH_RESULT_TYPE` | Only types with no Google rich result (for example FAQPage, HowTo) vf:faq-rich-results vf:howto-rich-results | Keep only if it describes the page; never sell it as a lever | That it harms ranking |
| `VALUE_NOT_VISIBLE` | A schema value is absent from visible text | Show it on the page or remove it [g-sd-policy] | - |
| `MISSING_REQUIRED` | A rich-result type lacks a required property (section 8 JSON) | Add it, if the value is true and visible | Eligibility. No API proves it; the Rich Results Test does |
| `DEPRECATED_PROP` | A superseded or unsupported property (for example `branchOf`) | Use the replacement (`parentOrganization`) [schema-branchof] | - |
| `DUPLICATE_ENTITY` | Two nodes describe the same entity (two Organizations) | One node with an `@id`; reference it | - |

`stack` column: `next | nuxt | wordpress | spa-shell | express | unknown`. Read section 3
before you suggest a fix.

## 2. Bots, robots.txt and the WAF

### Token table

Classes: **search** (builds an index the engine answers from), **user-fetch** (fetches one page
when a user asks), **training** (model training), **control** (a robots.txt token only; it
never fetches). Whole table: vf:openai-bot-tokens, vf:anthropic-bot-tokens,
vf:perplexity-bot-tokens, vf:google-extended-scope, vf:bot-ip-ranges.

| Token | Owner | Class | Honours robots.txt | IP ranges (JSON) |
|---|---|---|---|---|
| Googlebot | Google | search | yes [g-robots] | `https://developers.google.com/static/search/apis/ipranges/googlebot.json` |
| Google special crawlers | Google | various | per crawler | `.../ipranges/special-crawlers.json` |
| Google user-triggered fetchers | Google | user-fetch | "generally ignore" [g-user-fetch] | `.../ipranges/user-triggered-fetchers.json`, `.../user-triggered-fetchers-google.json` |
| Google-Extended | Google | control | yes; it is a token only | none |
| Bingbot | Microsoft | search | yes (practitioner; no Bing page read) | `https://www.bing.com/toolbox/bingbot.json` |
| OAI-SearchBot | OpenAI | search | yes [oai] | `https://openai.com/searchbot.json` |
| ChatGPT-User | OpenAI | user-fetch | "robots.txt rules may not apply" [oai] | `https://openai.com/chatgpt-user.json` |
| GPTBot | OpenAI | training | yes [oai] | `https://openai.com/gptbot.json` |
| Claude-SearchBot | Anthropic | search | yes [anth] | `https://claude.com/crawling/bots.json` (all three) |
| Claude-User | Anthropic | user-fetch | yes; Anthropic says all its bots honour robots.txt [anth] | same |
| ClaudeBot | Anthropic | training | yes [anth] | same |
| PerplexityBot | Perplexity | search; "not used to crawl content for AI foundation models" [pplx] | yes | `https://www.perplexity.com/perplexitybot.json` |
| Perplexity-User | Perplexity | user-fetch | "generally ignores robots.txt rules" [pplx] | `https://www.perplexity.com/perplexity-user.json` |
| Applebot | Apple | search | yes [apple] | - |
| Applebot-Extended | Apple | control (training) | yes; it "does not crawl webpages" [apple] | none |
| CCBot | Common Crawl | training corpus | yes [ccbot] | `https://index.commoncrawl.org/ccbot.json` |

All range files share one shape: `{"creationTime", "prefixes":[{"ipv4Prefix"|"ipv6Prefix"}]}`
(experiment, all fetched 200 on the check date). Google-Extended controls Gemini training **and**
grounding in Gemini Apps and Vertex AI; it "does not impact a site's inclusion in Google Search"
[g-common]. GPTBot does not power ChatGPT search; OAI-SearchBot does [oai].

### Template A: visibility (default)

```text
User-agent: *
Disallow:

Sitemap: https://www.example.com/sitemap.xml
```

Add `Disallow:` lines under `*` only for private paths (`/admin/`, `/api/`, cart, internal
search). Do not add named AI groups "to be explicit": a named group drops every `*` rule.

### Template B: licensing (user names training reuse as the concern)

```text
User-agent: *
Disallow: /admin/

# Training only. Search and user-fetch bots keep the * rules above.
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: CCBot
User-agent: Applebot-Extended
Disallow: /

Sitemap: https://www.example.com/sitemap.xml
```

- Ask about Google-Extended as a separate decision. Blocking it opts out of Gemini training
  **and** Gemini grounding, so Gemini answers stop drawing on the site [g-common]. It does not
  affect Google Search or AI Overviews. Add `User-agent: Google-Extended` to the group only on
  a yes.
- Never block OAI-SearchBot, Claude-SearchBot, PerplexityBot, Bingbot or Googlebot for
  licensing. That removes the site from AI answers and gives no training protection.
- "Training access helps recommendation" has no study behind it. It is this skill's judgement
  call; label it so if you say it.
- Test before it ships: `uv run scripts/probe.py --robots-file proposed.txt URL ...`.
  (experiment: protego evaluates Template B as GPTBot, ClaudeBot, CCBot, Applebot-Extended
  blocked; OAI-SearchBot, Claude-SearchBot, PerplexityBot, Google-Extended allowed.)

### Google semantics (official [g-robots])

- One group applies per crawler: the most specific matching user agent. Other groups,
  including `*`, are ignored. Groups for the same agent merge; a named group never merges
  with `*`. Group order does not matter.
- Within a group, the longest matching path wins; on a tie, the least restrictive rule wins.
- 500 KiB limit; content past it is ignored.
- 4xx (except 429) = no restrictions. 5xx or network error = crawling stops for 12 hours,
  then the last good copy is used for up to 30 days. Cached for up to 24 hours.
- Do not disallow JS or CSS a page needs to render [g-robots-intro].
- robots.txt is "not a mechanism for keeping a web page out of Google" [g-robots-intro].
- Python's `urllib.robotparser` gets longest-match, wildcards and group merging wrong. Use the
  probe (protego), never stdlib (experiment).

### CDN and WAF: robots.txt alone never proves access

- **Cloudflare.** AI bot policies live in Security Settings > Configure AI bot policies, with
  per-class presets (Search, Agent, Training) and Block / Block on pages with ads / Allow
  [cf-block]. New-zone defaults change: vf:cloudflare-ai-bot-default. The "Agent" class covers
  chat fetch bots, so a block there removes user-fetch access. Whether a training block also
  catches mixed search-and-training crawlers depends on the setting (vf:cloudflare-ai-bot-default).
  Check the zone's setting; never assume the default.
- **Cloudflare managed robots.txt** prepends its own groups to the origin file, including
  `Google-Extended: Disallow: /` [cf-robots] vf:cloudflare-managed-robots. Probe the live
  robots.txt, not the repo file.
- **Vercel.** Bot Protection and the AI Bots managed ruleset are both off by default. AI Bots
  set to Deny blocks all AI bot traffic; Bot Protection challenges non-browser clients but
  skips verified bots [vercel-bots] vf:vercel-ai-bots-ruleset. Bot Protection does not work
  behind another reverse proxy such as Cloudflare [vercel-bots].
- **Google Business Profile link verifier.** `Google-BusinessLinkVerification` does not follow
  robots.txt. A bot block, CAPTCHA, login, rate limit or IP block on a profile's website or
  booking link breaks the policy and gets the link removed [gbp-links] vf:gbp-link-verifier.
  Exempt those URLs from challenges. Check: `probe.py --ua gbp-verifier URL`.

### `UNRESOLVED` procedure (a bot UA gets 403, a browser gets 200)

1. Probe with `--compare-ua`. Sites that verify crawler IPs reject a spoofed UA from your IP,
   so the result proves only the UA rule (experiment: reddit.com returned 200 to a browser UA
   and 403 to spoofed Googlebot and GPTBot UAs).
2. Ask for logs or the CDN's bot analytics (section 9). Look for the real bot's status codes.
3. Check the log IP against the owner's range file (section 9 snippet). In range + 200 =
   access proven. In range + 403 = real block. Out of range = spoofed traffic; ignore it.
4. For Google, GSC URL Inspection also shows the fetch result for the indexed copy.

Always send a descriptive UA when you fetch range files.

## 3. Rendering fixes by stack

Detect first (experiment; signals observed on live sites):

| `stack` | Signals |
|---|---|
| `next` | `x-powered-by: Next.js`, `x-nextjs-*` headers, `self.__next_f` (App Router) or `__NEXT_DATA__` (Pages Router) |
| `wordpress` | `Link: <.../wp-json/>; rel="https://api.w.org/"`, `/wp-content/` paths |
| `spa-shell` | Empty `<div id="root">` or `<div id="app">`, same HTML on every path |
| `express` | `x-powered-by: Express` |

Hosting signals (not a stack): `server: Vercel` / `x-vercel-id`, `server: cloudflare` / `cf-ray`.

**Client-only SPA** (Vite or CRA React, AI site-builder output, Express serving `index.html`):

1. Prerender marketing routes at build time, or migrate them to SSR/SSG. Each route ships its
   own title, h1, body, canonical and links in raw HTML.
2. Serve real `robots.txt` and `sitemap.xml` files, and a real 404 for unknown paths,
   **before** the SPA catch-all route.
3. If an unknown route cannot get a server 404, use a JS redirect to a URL that returns 404,
   or add `noindex` with JS on error views (official [g-js]).
4. Use History API routes with `<a href>` links. Fragment (`#/page`) routes are not crawlable
   (official [g-js]).
5. Do not offer UA-based dynamic rendering as the fix (this skill's judgement). It hides the
   problem from a browser check and needs an AI bot list kept current.

**WordPress.** The SEO plugin already emits a JSON-LD `@graph`. Configure the plugin; never add
a second Organization by hand (practitioner).

**Any stack.** Never remove `noindex` with client JS. Google may skip rendering when it sees
`noindex` (official [g-js]).

## 4. Next.js App Router and Vercel

Each item ends the same way: build with the repo's runner, start it, and probe localhost
with `--base`.

- **Metadata only in Server Components.** `metadata` and `generateMetadata` are "only supported
  in Server Components" [next-meta]. Keep `page.tsx` a server file and move client logic into
  a child component. Never set `document.title` in `useEffect`: raw HTML then has no title.
- **`metadataBase`.** Set it in `app/layout.tsx`. A relative URL in a URL-based metadata field
  without `metadataBase` "will cause a build error" [next-meta].
- **Streamed metadata.** When `generateMetadata` resolves after the first bytes, Next.js
  appends the tags to `<body>` for every UA not matched by `htmlLimitedBots` [next-meta]. The
  default regex has Google crawler tokens, Bingbot and social bots, but no OpenAI, Anthropic or
  Perplexity token [next-html-bots] vf:next-html-limited-bots. Fix in this order:
  1. Make SEO metadata prerenderable: no runtime data and no uncached fetch in
     `generateMetadata`. With Cache Components, a page that is otherwise fully prerenderable
     raises an error until you choose `use cache` or mark deferral as intended [next-meta].
  2. Else set `htmlLimitedBots: /.*/` in `next.config.ts`. This is the documented switch that
     disables streaming for all UAs, and it costs TTFB [next-limited]. A custom regex
     replaces the default list; it does not extend it [next-limited].
  3. Verify: `probe.py --ua oai-searchbot --base ... URL` shows no `TITLE_IN_BODY`.
- **One canonical per page.** Metadata merges shallowly: nested objects such as `openGraph`
  and `robots` are replaced whole by the last segment that sets them [next-meta]. A canonical
  set in the root layout is therefore inherited by every page that sets none: every page then
  claims the home page. Set `alternates.canonical` per page (or per `generateMetadata`).
- **`sitemap.ts`.** `lastModified` from content dates, never `new Date()`. Leave out
  `priority` and `changeFrequency`: Google ignores both and uses `lastmod` only when it is
  "consistently and verifiably" accurate [g-sitemap].
- **Missing records.** Call `notFound()` in the render path. It returns a 404 and injects
  `noindex` [next-notfound]. A page that renders "not found" with status 200 is a soft 404.
- **ISR and caches.** Revalidated or cached routes can serve stale metadata and canonicals
  after a change (practitioner [kennard]). Probe after the cache expires or after a purge.
- **Vercel preview hosts.** Preview deployments get `X-Robots-Tag: noindex`, but a custom
  domain on a non-production branch (`staging.example.com`) does not [vercel-kb]
  vf:vercel-custom-domain-noindex. Add a header in `next.config` `headers()` when
  `process.env.VERCEL_ENV === 'preview'` [vercel-kb]. Verify with `curl -sI` on that host.

## 5. Indexing

Walk this order and fix the first failure only. Then rerun the probe.

```text
raw HTML has content -> 200 -> no noindex (meta + header) -> self canonical
  -> linked by <a href> from an indexed page -> in sitemap -> GSC page state
```

| GSC Page indexing state [gsc-pages] | First check |
|---|---|
| Discovered - currently not indexed | Internal links and crawl demand; template sameness at scale |
| Crawled - currently not indexed | Raw HTML content (`THIN_RAW_HTML`), duplication, value |
| Duplicate, Google chose different canonical | Canonical tag vs redirects vs sitemap vs internal links |
| URL marked 'noindex' | `NOINDEX` / `X_ROBOTS_NOINDEX` on that URL |
| Blocked by robots.txt | Robots matrix |
| Soft 404 | Thin or error-looking content on a 200 |
| Page with redirect | Expected for old URLs; not for sitemap URLs |

- `Disallow` stops crawling, not indexing. A disallowed URL can be indexed without content,
  and its `noindex` is never seen [g-robots-meta] [g-canon]. To remove a page: allow crawling
  and send `noindex`.
- Do not use robots.txt or the removal tool for canonicalisation; do not give different
  canonicals in the sitemap and the tag [g-canon].
- GSC URL Inspection reports the indexed copy only; "you cannot test the indexability of a
  live URL" through the API [gsc-inspect]. The UI "Test live URL" is manual.
- Sitemaps: follow redirects (`curl -L`), gunzip `.xml.gz`, recurse into index files. Limit
  50 MB uncompressed or 50,000 URLs per file [g-sitemap]. Sample `<loc>` URLs: each should
  return 200 with no redirect.

## 6. Discovery writes (ask first)

- **IndexNow** reaches Bing, Yandex, Seznam, Naver, Yep, Internet Archive and Amazonbot; Google
  is not a participant [indexnow] vf:indexnow-participants. It needs a key file on the host.
- **Google Indexing API** is only for pages with `JobPosting` or `BroadcastEvent` in a
  `VideoObject` [g-indexing-api] vf:google-indexing-api-scope. Never use it for other pages.
- Sitemap submission in GSC or Bing is also a write. All of these need the user's approval for
  that exact action.

## 7. Migrations (slugs, URLs, domains)

1. Export every old URL: sitemap, GSC Pages export, logs, analytics landing pages.
2. Map each old URL to one final URL. Redirect in one hop with 301 or 308; no chains, and no
   mass redirects to the home page [g-move].
3. Point canonicals, internal links and the sitemap at final URLs.
4. Keep redirects "generally at least 1 year"; for users, consider keeping them indefinitely
   [g-move].
5. Do not ship a redesign in the same release; one change at a time keeps cause visible
   (practitioner).
6. After launch, probe the full old URL list: each must be old -> one 301/308 hop -> 200
   self-canonical.

## 8. Schema

- **Use:** Organization (with `sameAs`) and WebSite sitewide, BreadcrumbList, Article, Product
  or SoftwareApplication where eligible, a LocalBusiness subtype for real premises, Event,
  JobPosting, VideoObject.
- **Do not use:** FAQPage or HowTo for rich results (vf:faq-rich-results,
  vf:howto-rich-results); `aggregateRating` or `review` the site controls about itself on
  Organization or LocalBusiness pages, including embedded Google or Facebook review widgets
  [g-review]; ratings copied from other sites, such as G2 ("Don't aggregate reviews or ratings
  from other websites") [g-review]; values not visible on the page [g-sd-policy];
  placeholders; `branchOf` [schema-branchof].
- **`@graph` is valid.** One top-level `@context` covers every node; nodes need no
  `@context` of their own. Resolve `@id` references before you call a property missing.
- **Validation.** The schema.org validator checks vocabulary only: `POST
  https://validator.schema.org/validate` with `url=` or `html=`, strip the leading `)]}'`
  line. It is undocumented; on failure write `SKIPPED` (experiment). Google eligibility has
  no API: use the Rich Results Test in a browser.
- Schema is for rich results and entity identity. It is not an AI citation lever.

### Required properties

The `REQUIRED` map in `scripts/probe.py` holds the required and one-of properties per type,
from each type's Google structured-data page [g-sd-types] vf:google-required-properties.
Read it there; `MISSING_REQUIRED` flags reference it.

LocalBusiness subtypes (for example `ExerciseGym`, `Dentist`, `Restaurant`) inherit its
rules. SoftwareApplication needs a rating or review for its rich result; with no genuine
first-party reviews, it has none. Do not fill the gap with G2 or app-store ratings. Organization
and Article have no required properties.

## 9. Logs

Ask which log source exists: origin access logs, Cloudflare (Logpush, or AI Crawl Control,
which shows crawler activity and robots.txt compliance on all plans [cf-acc]), or a Vercel
log drain. Do not assume one.

Bot hits by status and IP from a combined-format log (experiment: tested on a sample log):

```sh
awk -F'"' 'match($6,/GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Claude-User|PerplexityBot|Perplexity-User|Googlebot|Bingbot|Applebot|CCBot/){split($3,s," ");split($1,ip," ");print substr($6,RSTART,RLENGTH),s[1],ip[1]}' access.log | sort | uniq -c | sort -rn | head -30
```

Verify an IP against a range file (experiment: 66.249.66.1 verified as Googlebot):

```sh
python3 - IP RANGE_JSON_URL <<'EOF'
import ipaddress, json, sys, urllib.request
ip, url = ipaddress.ip_address(sys.argv[1]), sys.argv[2]
req = urllib.request.Request(url, headers={"User-Agent": "seo-geo-ipcheck/1.0"})
nets = [ipaddress.ip_network(p.get("ipv4Prefix") or p.get("ipv6Prefix")) for p in json.load(urllib.request.urlopen(req))["prefixes"]]
print(ip, "VERIFIED" if any(ip in n for n in nets) else "NOT IN RANGE")
EOF
```

Logs prove which bots reached which pages with which status. They do not prove citations.

## Sources

[anth]: https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler
[apple]: https://support.apple.com/en-us/119829
[ccbot]: https://commoncrawl.org/ccbot
[cf-acc]: https://developers.cloudflare.com/ai-crawl-control/
[cf-block]: https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/
[cf-robots]: https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/
[gbp-links]: https://support.google.com/business/answer/13769188
[g-canon]: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
[g-common]: https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers
[g-googlebot]: https://developers.google.com/search/docs/crawling-indexing/googlebot
[g-indexing-api]: https://developers.google.com/search/apis/indexing-api/v3/quickstart
[g-js]: https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
[g-move]: https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes
[g-review]: https://developers.google.com/search/docs/appearance/structured-data/review-snippet
[g-robots]: https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt
[g-robots-intro]: https://developers.google.com/search/docs/crawling-indexing/robots/intro
[g-robots-meta]: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag
[g-sd-policy]: https://developers.google.com/search/docs/appearance/structured-data/sd-policies
[g-sd-types]: https://developers.google.com/search/docs/appearance/structured-data/search-gallery
[g-sitemap]: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
[g-user-fetch]: https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers
[gsc-pages]: https://support.google.com/webmasters/answer/7440203
[gsc-inspect]: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
[indexnow]: https://www.indexnow.org/searchengines.json
[kennard]: https://www.willkennard.com/digital-blog/making-sense-nextjs-caching-for-developers-seos
[next-html-bots]: https://github.com/vercel/next.js/blob/canary/packages/next/src/shared/lib/router/utils/html-bots.ts
[next-isbot]: https://github.com/vercel/next.js/blob/canary/packages/next/src/shared/lib/router/utils/is-bot.ts
[next-limited]: https://nextjs.org/docs/app/api-reference/config/next-config-js/htmlLimitedBots
[next-meta]: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
[next-notfound]: https://nextjs.org/docs/app/api-reference/functions/not-found
[oai]: https://developers.openai.com/api/docs/bots
[pplx]: https://docs.perplexity.ai/docs/resources/perplexity-crawlers
[schema-branchof]: https://schema.org/branchOf
[vercel-bots]: https://vercel.com/docs/bot-management
[vercel-kb]: https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines
