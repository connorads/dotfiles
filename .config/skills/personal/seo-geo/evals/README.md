# seo-geo evals

Test cases, fixtures and maintainer checks for the skill. The skill does not read this directory at runtime.

## Run

```sh
run_evals.py <skill-dir> --agent claude --runs 3 --max-cost-usd 15
run_evals.py <skill-dir> --agent codex --runs 1
```

`run_evals.py` ships with the writing-skills skill. It copies each case's `files` into a fresh workspace under their basenames and replaces `<workspace>` in the prompt.

- `*-adhoc` cases are the ad-hoc arm: the baseline prompt plus one sentence. Read only their `without_skill` results. The skill must beat them.
- Cases with `"should_trigger": false` are near-misses. A pass means no `probe.py` run.
- `triggers.json` holds 18 trigger queries: 12 train, 6 validation, 3 runs each.
- spa-shell cases run a server. `serve.py` binds the port in the prompt, or a free port when that one is taken, and prints the URL it uses.
- next-app and local-chain need `pnpm install` (network) before they build. They pin `next` and `react` versions.

## Fixtures and what each plants

| Fixture | Business | Planted |
| --- | --- | --- |
| `spa-shell/` | Brightdesk, helpdesk SaaS | Same HTML shell with 200 for every path, including `/robots.txt`, `/sitemap.xml` and unknown paths; self-canonical per path (soft-404 host); `X-Powered-By: Express`; title, meta description, keywords, OG with relative image in raw HTML; empty `#root`, no h1, 0 body words; `assets/app.js` renders h1 + about 1,150 words on `/` only; `/pricing` (linked in nav) renders a client-side "404" h1 |
| `next-app/` | Rotaly, rota SaaS (Next 15 App Router, pnpm) | See the next-app list below |
| `local-chain/` | Northgate Dental, 12 clinics (Next 15, pnpm) | See the local-chain list below |
| `gsc-export/` | Tablekit, restaurant SaaS that pivoted from table booking to guest marketing | See the gsc-export list below |
| `product-facts/` | Rotaly | `facts.md` (pricing, integrations, limits, 2 numbers, 3 attributed quotes, no competitor data); `vs-deputy.md` with a "#1" title, unsourced claims, a Yes/No table where Deputy loses every row, and an old `updated` date |
| `plan/` | Rotaly | `MARKETING_PLAN.md`: llms.txt as the #1 GEO lever; 40 templated AI "vs" pages; 20 self-ranked "best X" listicles; 400 AI city pages; more sitewide FAQ schema; Lighthouse 100 before anything else; £500/mo AI rank tracker on a 12-month contract; 4 AI blog posts a week plus a monthly date refresh; 20 bought DR50+ guest links a month; "AI rank score" as the success metric |
| `bot-policy/` | Harbour and Pine, shop behind Cloudflare | `robots.txt`: a named `OAI-SearchBot` group that drops every `*` rule (`/admin/`, `/checkout/`, `/search`, `/account/` open to it); `GPTBot` fully blocked; PerplexityBot falls under `*`; `Crawl-delay` (Google ignores it); no Google-Extended line |

### next-app

1. `app/pricing/page.tsx` is `"use client"`: `document.title` set in `useEffect`; plans fetched from `/api/plans` after hydration; raw HTML shows a spinner with no h1.
2. Root layout OG and Twitter images are relative (`/og.png`), with no `metadataBase`. Home `alternates.canonical` is relative too.
3. Root layout hard-codes `<link rel="canonical" href="https://rotaly.io/">` in `<head>`. Home and blog pages get two canonicals. Pricing and city pages get only the home canonical.
4. `app/blog/[slug]/page.tsx`: `force-dynamic`, and `generateMetadata` awaits a 2 s CMS call (`lib/posts.ts`), so metadata streams into the body for user agents outside Next's HTML-limited bot list.
5. An unknown blog slug renders "Post not found" with status 200 (no `notFound()`).
6. `app/sitemap.ts`: `lastModified: new Date()`, `priority` and `changeFrequency` on every URL; it lists the city pages.
7. `public/robots.txt` blocks GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot and ClaudeBot.
8. Root layout already emits a valid Organization + WebSite `@graph` with `@id` and `sameAs`. It is a trap for "add Organization schema".
9. `components/FaqSchema.tsx` renders self-promotional FAQPage JSON-LD sitewide, with no visible FAQ.
10. `README.md`: `staging.rotaly.io` is a custom domain on the `staging` branch. Vercel adds no automatic noindex there.
11. `app/locations/[city]/page.tsx`: "Best Rota Software in {city}" for 15 cities, city swap only (doorway/scaled content).
12. Layout `keywords` meta stuffing.
13. For the CLS near-miss: `next/font` Inter with `display: "swap"` and `adjustFontFallback: false`; pricing plans pop in with no reserved space; `components/Hero.tsx` lazy-loads the 2400px hero image.

### local-chain

1. `data/cities.json`: 12 entries with `hasPremises: true` and clinic data; 40 nearby towns with `hasPremises: false`, `clinic: null` and a `nearest` clinic. The prompt asks for pages for all of them.
2. `app/locations/[slug]/page.tsx` swaps only the city name: no address, phone or hours in the visible HTML, and repetitive "dentist in {city}" copy.
3. Opening hours and booking appear only in a SmileBook `<iframe>`.
4. Location JSON-LD: `Dentist` with the location-suffixed name `Northgate Dental - {city}`; `branchOf` and no `parentOrganization`, although layout has Organization `@id` `https://northgatedental.co.uk/#org`; the same hard-coded Google `aggregateRating` (4.9, 1287) on every clinic; `geo` at 2 decimals; telephone and address in schema but not on the page.
5. `lib/reviews.ts`: an NPS text first, then the Google review link only for a score of 9 or more, and a private feedback form otherwise (gating). The Google ask says "mention {dentistName} by name". No pacing.
6. `README.md`: all 12 Google Business Profiles link to the homepage; the Book button goes to SmileBook.

### gsc-export

UI-export shape (`Dates.csv`, `Queries.csv`, `Pages.csv`, `Filters.csv`) plus `query_page.csv` in an API-style shape. The window is the last 16 months, 2025-06-03 to 2026-09-30. Queries and pages cover the whole window.

1. Clicks: `Dates.csv` totals 4,210; `Queries.csv` sums to 2,950, a gap of 1,260 (30%) from anonymised queries; `Pages.csv` sums to 4,090.
2. Seasonal: clicks average about 310/month in Mar-May 2026 and fall about 29% in Jun-Aug 2026. Jun-Aug 2025 (626 clicks) shows the same dip, and Jun-Aug 2026 (664) is up about 6% year on year. Sept 2025 recovers.
3. Reporting artefact: from 2025-09-12, daily impressions drop from about 600 to about 380 and average position moves from about 31 to about 20, while clicks do not change.
4. Cannibal pair: "restaurant email marketing" splits between `/blog/restaurant-email-marketing-guide` (position 6.1, 4,300 impressions) and `/features/email-campaigns` (position 9.2, 3,300 impressions).
5. Striking distance, page 2 with high impressions: `/blog/restaurant-loyalty-program-guide` (15.7), `/features/guest-crm` (13.0), `/blog/restaurant-sms-marketing` (13.3).
6. CTR gap: `/blog/restaurant-newsletter-examples` (position 4.8, CTR 0.27%) and `/integrations/opentable` (position 3.8, CTR 0.29%), where peers at positions 1-5 get 4.5% or more.
7. Legacy demand after the pivot: table-booking queries ("free table booking widget", "restaurant reservation system", "online table booking for restaurants", "free restaurant booking system", "table booking app", "restaurant booking widget wordpress", "tablekit booking widget") and no-show queries take about a third of query clicks. They land on `/table-booking` and `/blog/free-table-booking-widget`.
