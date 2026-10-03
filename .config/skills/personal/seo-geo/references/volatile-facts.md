# Volatile facts

Facts here change within months. Other files point to a row as `vf:<id>`.

Before you state a fact from this file:

1. Find its row by id.
2. If `checked` is more than 90 days old, or the user contradicts it, fetch
   the primary source and use what it says now. Tell the user you checked.
3. If the source no longer says it, do not state the fact. Report the
   drift.
4. A perishable fact with no row: check it live, then say you checked it.

`evals/check_facts.py` rechecks every row with a machine check (its
`evals/fact-claims.json` entry holds the URL and the text that must or must
not appear). Run it on every revision of this skill.

Status column: evidence label (`official`, `experiment`, `correlation`,
`practitioner`, `contested`), then `current`, `changing` (a dated change is
announced) or `unverified` (no primary source read; do not state it as fact).

## Contents

1. Crawlers and robots.txt
2. CDN, WAF and hosting
3. Frameworks
4. Google Search features and limits
5. Measurement
6. Local, listings and reviews
7. Tools
8. Not verified

## 1. Crawlers and robots.txt

| id | fact | status | primary source | checked | recheck when |
|---|---|---|---|---|---|
| openai-bot-tokens | `OAI-SearchBot` = ChatGPT search; opted-out sites are not shown in ChatGPT search answers but "can still appear as navigational links". `GPTBot` = training only. `ChatGPT-User` = user actions; "robots.txt rules may not apply"; not used for Search inclusion. `OAI-AdsBot` visits ad landing pages only. robots.txt changes take about 24 h for search | official, current | <https://developers.openai.com/api/docs/bots> | 2026-10-03 | OpenAI adds or renames a token |
| anthropic-bot-tokens | `ClaudeBot` = training. `Claude-User` = user-directed fetches; blocking it stops retrieval for user queries. `Claude-SearchBot` = search indexing. Anthropic says all three honour robots.txt and that IP blocking "may not work correctly" as an opt-out | official, current | <https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler> | 2026-10-03 | Page changes the bot list |
| perplexity-bot-tokens | `PerplexityBot` = search results, "not used to crawl content for AI foundation models". `Perplexity-User` = user fetches; "generally ignores robots.txt rules". IP lists live on perplexity.com | official, current | <https://docs.perplexity.ai/guides/bots> | 2026-10-03 | Page changes |
| google-extended-scope | `Google-Extended` is a robots.txt control token only (no own UA). It governs Gemini training and grounding in Gemini Apps and Vertex AI. "Google-Extended does not impact a site's inclusion in Google Search nor is it used as a ranking signal". It does not control AI Overviews or AI Mode | official, current | <https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers> | 2026-10-03 | Google changes the scope text |
| google-user-fetchers | Google user-triggered fetchers (Google-Agent, Gemini Notebook and others) "generally ignore robots.txt rules". `Google-NotebookLM` UA is supported until Aug 2026, replaced by `Google-GeminiNotebook` | official, current | <https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers> | 2026-10-03 | New fetcher listed |
| apple-bot-tokens | `Applebot` feeds Spotlight, Siri and Safari search and may train Apple models. Disallow `Applebot-Extended` to opt out of training; `nosnippet` opts content out of Siri/Search world-knowledge answers. Both leave the site discoverable | official, current | <https://support.apple.com/en-us/119829> | 2026-10-03 | Page changes |
| meta-bot-tokens | `meta-externalagent` crawls for AI training or product indexing. `meta-externalfetcher` does user-requested fetches and "may bypass robots.txt rules" | official, current | <https://developers.facebook.com/docs/sharing/webmasters/web-crawlers> | 2026-10-03 | Page changes |
| ccbot | Common Crawl's `CCBot/2.0` honours robots.txt. Its corpus feeds many model trainers | official, current | <https://commoncrawl.org/ccbot> | 2026-10-03 | Yearly |
| bot-ip-ranges | Published range files, one shared JSON shape: Googlebot, Google special and user-triggered (developers.google.com/static/search/apis/ipranges/), Bingbot (bing.com/toolbox/bingbot.json), GPTBot, OAI-SearchBot, ChatGPT-User (openai.com/{gptbot,searchbot,chatgpt-user}.json), Anthropic (claude.com/crawling/bots.json), PerplexityBot and Perplexity-User (perplexity.com/{perplexitybot,perplexity-user}.json). openai.com returns 403 to the default Python UA, so send a UA | official + experiment, current | <https://developers.openai.com/api/docs/bots> | 2026-10-03 | A range URL returns non-200 |
| gbp-link-verifier | `Google-BusinessLinkVerification` checks Business Profile links at most daily, ignores robots.txt, and needs 200 with no CAPTCHA, login, rate limit, IP or UA block, or cloaking. A failed check can remove the link | official, current | <https://support.google.com/business/answer/13769188> | 2026-10-03 | Policy page changes |
| google-robots-limits | robots.txt over 500 KiB is truncated. A 5xx robots.txt stops crawling for 12 h, then Google uses the last good copy for 30 days | official, current | <https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt> | 2026-10-03 | Yearly |

## 2. CDN, WAF and hosting

| id | fact | status | primary source | checked | recheck when |
|---|---|---|---|---|---|
| cloudflare-ai-bot-default | Since 1 Jul 2025 every new Cloudflare domain is asked at sign-up whether to allow AI crawlers. On 15 Sep 2026 new-domain defaults became: Training and Agent bots blocked on pages that show ads, Search allowed; training blocks also catch mixed search-and-training crawlers. The legacy "Block AI bots" toggle is deprecated from that date. Agent covers chat fetch bots | official, changing | <https://developers.cloudflare.com/bots/additional-configurations/block-ai-bots/> | 2026-10-03 | Docs drop the "will" wording or change classes |
| cloudflare-managed-robots | Cloudflare managed robots.txt prepends its own groups (including `Google-Extended`, `Applebot-Extended`, `GPTBot` disallows) to the origin file | official, current | <https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/> | 2026-10-03 | Page changes the bot list |
| vercel-ai-bots-ruleset | Vercel Firewall has an AI bots managed ruleset (log or deny) on all plans. Bot Protection skips verified bots and does not work behind another reverse proxy such as Cloudflare | official, current | <https://vercel.com/docs/bot-management> | 2026-10-03 | Page changes |
| vercel-custom-domain-noindex | Vercel adds `X-Robots-Tag: noindex` to every Preview Deployment, except one served on a custom domain | official, current | <https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines> | 2026-10-03 | KB changes |

## 3. Frameworks

| id | fact | status | primary source | checked | recheck when |
|---|---|---|---|---|---|
| next-html-limited-bots | Next.js `HTML_LIMITED_BOT_UA_RE` (gets blocking, in-head metadata) covers `-Google`/`Google-` crawlers, Bingbot, applebot, social bots and others, but no OpenAI, Anthropic or Perplexity token. Plain `Googlebot` is a "dom" bot that runs JS. Setting `htmlLimitedBots` replaces the default list; `htmlLimitedBots: /.*/` disables streaming metadata for all UAs | official, current | <https://raw.githubusercontent.com/vercel/next.js/canary/packages/next/src/shared/lib/router/utils/html-bots.ts> | 2026-10-03 | Each Next.js minor release |
| next-metadata-rules | `metadata`/`generateMetadata` work only in Server Components. A relative URL metadata field without `metadataBase` is a build error. Runtime metadata streaming on an otherwise prerenderable page raises an error (docs v16.3.8) | official, current | <https://nextjs.org/docs/app/api-reference/functions/generate-metadata> | 2026-10-03 | Each Next.js major release |

## 4. Google Search features and limits

| id | fact | status | primary source | checked | recheck when |
|---|---|---|---|---|---|
| faq-rich-results | FAQ rich results stopped appearing from 7 May 2026 (notice added 8 May 2026). Google removed the FAQ documentation on 15 Jun 2026. FAQ impressions in GSC drop from 7 May 2026 | official, current | <https://developers.google.com/search/updates> | 2026-10-03 | Never returns; keep row for history |
| howto-rich-results | HowTo rich results are no longer shown; Google removed the docs on 14 Sep 2023 | official, current | <https://developers.google.com/search/updates> | 2026-10-03 | None |
| google-ai-guide-myths | Google's AI optimisation guide says llms.txt and other AI files, chunking, rewriting for AI, inauthentic mentions and special schema are not needed for Google Search or its AI features (page updated 2026-07-10) | official, current | <https://developers.google.com/search/docs/fundamentals/ai-optimization-guide> | 2026-10-03 | Page "Last updated" changes |
| googlebot-fetch-limit | For Google Search, Googlebot reads the first 2 MB of a supported file (64 MB for PDF); each CSS/JS resource has the same cap. Google crawlers in general default to 15 MB | official, current | <https://developers.google.com/search/docs/crawling-indexing/googlebot> | 2026-10-03 | Page changes |
| google-indexing-api-scope | Google's Indexing API is for `JobPosting` and livestream `BroadcastEvent` pages only | official, current | <https://developers.google.com/search/apis/indexing-api/v3/quickstart> | 2026-10-03 | Yearly |
| indexnow-participants | IndexNow participants: Bing, Yandex, Seznam, Naver, Yep, Internet Archive, Amazonbot. Google is not one | official, current | <https://www.indexnow.org/searchengines.json> | 2026-10-03 | Quarterly |
| sitemap-hints | Google ignores `<priority>` and `<changefreq>`; it uses `<lastmod>` only if consistently accurate | official, current | <https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap> | 2026-10-03 | Yearly |
| review-snippet-rules | Review snippets: "Don't aggregate reviews or ratings from other websites"; no fake or undisclosed incentivised reviews; a LocalBusiness or Organization that controls reviews about itself (including embedded Google or Facebook widgets) is ineligible for stars (page updated 2026-09-08) | official, current | <https://developers.google.com/search/docs/appearance/structured-data/review-snippet> | 2026-10-03 | Page "Last updated" changes |
| google-required-properties | Required and recommended properties per rich-result type live on each type's page, indexed from the search gallery | official, current | <https://developers.google.com/search/docs/appearance/structured-data/search-gallery> | 2026-10-03 | Gallery adds or drops a type |
| localbusiness-subtype | Google asks for the most specific LocalBusiness subtype (examples include `HealthClub`, `Restaurant`, `DaySpa`); page updated 2026-09-08. schema.org `ExerciseGym` sits under `SportsActivityLocation`; `branchOf` is superseded by `parentOrganization` | official, current | <https://developers.google.com/search/docs/appearance/structured-data/local-business> | 2026-10-03 | Page "Last updated" changes |
| spam-doorways | Doorway examples include "pages targeted at specific regions or cities that funnel users to one page". Scaled content abuse applies "no matter how it's created" (page updated 2026-08-28) | official, current | <https://developers.google.com/search/docs/essentials/spam-policies> | 2026-10-03 | Page "Last updated" changes |
| url-inspection-indexed-only | The URL Inspection API reports only the indexed version; "you cannot test the indexability of a live URL". Quota 2,000/day and 600/min per site; Search Analytics 1,200 QPM per site | official, current | <https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect> | 2026-10-03 | Yearly |

## 5. Measurement

| id | fact | status | primary source | checked | recheck when |
|---|---|---|---|---|---|
| ga4-ai-assistant-channel | GA4 default channel group has "AI Assistant" (medium `ai-assistant`, campaign `(ai-assistant)`) for sources "like ChatGPT, Gemini, Deepseek, Copilot, or Grok". It excludes Google AI Overviews and AI Mode | official, current | <https://support.google.com/analytics/answer/9756891> | 2026-10-03 | Help page changes the source list |
| gsc-genai-report | GSC Generative AI performance report (Search) shows impressions only, for AI Overviews and AI Mode, by page, country, date and device. No query dimension, no clicks. A separate report covers Discover. Missing report = too few impressions | official, current | <https://support.google.com/webmasters/answer/16984139> | 2026-10-03 | Report adds metrics or features |
| gsc-genai-control | GSC Settings > Search generative AI can include or exclude a site from AI Overviews, AI Mode and Discover generative AI. Exclusion also stops grounding there; child properties inherit the parent's choice by default | official, current | <https://support.google.com/webmasters/answer/16908024> | 2026-10-03 | Help page changes |
| gsc-impressions-logging-2025 | A logging error misreported impressions (and CTR, average position) from 13 May 2025 to 27 Apr 2026. Clicks were not affected | official, current | <https://support.google.com/webmasters/answer/6211453> | 2026-10-03 | Entry ages off the page (3-16 months) |
| gsc-num100 | Around Sept 2025 Google stopped honouring `&num=100`; GSC desktop impressions fell and average position rose with no change in demand | practitioner, current | <https://brodieclark.com/the-great-decoupling-num100/> | 2026-10-03 | Google documents it |
| gsc-branded-filter | GSC has a branded / non-branded query filter; Google says some queries may be misclassified | official, current | <https://support.google.com/webmasters/answer/17011259> | 2026-10-03 | Help page changes |
| bing-ai-performance | Bing Webmaster Tools AI Performance (public preview, Feb 2026): citation counts for Copilot, Bing AI summaries and partner integrations, cited pages, sampled grounding queries; no clicks. Intents, Topics, Citation Share and Compare added Jun 2026 | official, current | <https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview> | 2026-10-03 | Preview ends or API added |
| bing-ai-performance-api | No AI Performance method in the Bing Webmaster API reference; use UI exports | official, current | <https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi?view=bing-webmaster-dotnet> | 2026-10-03 | Each Bing Webmaster release |
| cwv-thresholds | Core Web Vitals "good" at p75: LCP <= 2.5 s, INP <= 200 ms, CLS <= 0.1 | official, current | <https://web.dev/articles/vitals> | 2026-10-03 | Yearly |

## 6. Local, listings and reviews

| id | fact | status | primary source | checked | recheck when |
|---|---|---|---|---|---|
| google-review-policy | Google Maps bans incentives, discouraging negative reviews, selective solicitation of positive reviews, on-premises pressure, asking for specific content, staff review quotas, and staff-named solicitation. The page carries no date; the staff clauses were reported on 17 Apr 2026 | official, current | <https://support.google.com/contributionpolicy/answer/7400114> | 2026-10-03 | Page text changes |
| gbp-review-restrictions | Fake-engagement violations can block new reviews, unpublish existing ones for a set period and show a warning; owners can appeal (official). Durations (30 days, doubling to 2 months for repeats from Jul 2026) are reported only by SET | official (types) + practitioner (durations), current | <https://support.google.com/business/answer/14114287> | 2026-10-03 | Google publishes durations |
| gbp-chain-rules | All locations in a country share one name and, for the same service, one category. Google's category example: "24-Hour Fitness" is a Health Club | official, current | <https://support.google.com/business/answer/3038177> | 2026-10-03 | Guidelines change |
| gbp-qa-status | My Business Q&A API discontinued 3 Nov 2025 (official). Front-end Q&A replaced by the Maps "Ask" feature, per a Google product expert, Dec 2025 (practitioner, SET). Ask Maps reported available in the US and India, Apr 2026 (practitioner, SET) | official + practitioner, current | <https://developers.google.com/my-business/content/sunset-dates> | 2026-10-03 | Google help page on Ask appears |
| apple-business | Apple Business replaced Apple Business Connect on 14 Apr 2026; Business Connect location data moved across | official, current | <https://www.apple.com/newsroom/2026/03/introducing-apple-business-a-new-all-in-one-platform-for-businesses-of-all-sizes/> | 2026-10-03 | Yearly |
| bing-places | Bing Places moved from bingplaces.com to bing.com/forbusiness and imports listings | official, current | <https://blogs.bing.com/search/2025/10/Introducing-the-New-Bing-Places-for-Business-Built-for-Business-Owners,-Powered-by-Research/> | 2026-10-03 | Yearly |
| reserve-with-google-partners | Reserve with Google partner list includes Square, Setmore, SimplyBook.me, Booksy, Fresha, Wix, Mindbody, Wellness Living and StudioDirector, among others. It affects conversion, not rank | official (list), current | <https://www.google.com/maps/reserve/partners> | 2026-10-03 | Before naming a partner |
| yelp-openai | Yelp licenses reviews, photos and business data to OpenAI for ChatGPT (reported 23 Jul 2026). Yelp filled 95.83% of ChatGPT business-card runs in one 2,879-run US study. UK and other markets are unmeasured | practitioner (news + one study), current | <https://finance.yahoo.com/media-advertising/articles/exclusive-yelp-deal-pushes-local-130005436.html> | 2026-10-03 | Quarterly; any non-US study |
| uk-cma208 | UK CMA208 (4 Apr 2025): "encouraging just those who are satisfied to leave reviews" is cherry-picking; arbitrary stop-start of invitations is suppression | official, current | <https://www.gov.uk/government/publications/fake-reviews-cma208> | 2026-10-03 | CMA revises guidance |
| us-ftc-reviews-rule | US FTC final rule (16 CFR 465, Aug 2024) bans fake reviews and testimonials, including buying and selling them | official, current | <https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials> | 2026-10-03 | Yearly |

## 7. Tools

| id | fact | status | primary source | checked | recheck when |
|---|---|---|---|---|---|
| lighthouse-version | Lighthouse latest on npm is 13.5.0. Run it as `pnpm dlx lighthouse@<version>` | official, current | <https://registry.npmjs.org/lighthouse/latest> | 2026-10-03 | Before quoting audit names |
| lighthouse-agentic-audits | Lighthouse 13.5.0 ships `agentic/` audits (`llms-txt`, `agent-accessibility-tree`, `ard-schema`). They are not Google ranking signals | official (code), current | <https://unpkg.com/lighthouse@13.5.0/core/audits/agentic/> | 2026-10-03 | Each Lighthouse major release |
| schema-validator-endpoint | `POST https://validator.schema.org/validate` returns JSON after a `)]}'` prefix. It is undocumented and checks vocabulary only; on failure report `SKIPPED` | experiment, current | <https://validator.schema.org/> | 2026-10-03 | Every use |
| psi-keyless | PageSpeed Insights API calls without a key returned 429 (daily quota) on 2026-10-03. Use a key; do not assert Google's quota | experiment, current | <https://developers.google.com/speed/docs/insights/v5/get-started> | 2026-10-03 | Every use |

## 8. Not verified

Do not state these as fact. Each needs a primary-source read and a row above.

| claim | why unverified | what was tried |
|---|---|---|
| GSC UI export file names (`Dates.csv`, `Queries.csv`, `Pages.csv`) and no query x page pairs | No real export in hand | Confirm on the first real export |
| GBP bulk export column names | No real export in hand | Same |
| GBP review-block durations (30 days, doubling) | SET only | Google's restrictions page names no durations |
| Ask Maps markets | SET only | No Google help page found |
| Yelp data use in ChatGPT outside the US | No study | Yahoo/Axios report covers the US deal only |
| Kevin Indig: 44% of ChatGPT citations from the first 30% of a page | Paywalled | Not opened; keep out |
| "Training-bot access helps recommendation" | No study | It is this skill's judgement; label it so |
| Bing crawler list beyond `bingbot` | Bing's help page renders client-side | Page fetched; no text in raw HTML |
