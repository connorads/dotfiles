# Evidence

Use this file to answer "says who?", to label a claim, to refuse with a
quote, or to sanity-check an SEO, GEO or AEO plan.

## Contents

1. Labels and citation format
2. Myths, with quotable sources
3. The GEO paper, corrected
4. Contested claims
5. Study numbers, labelled
6. Plan sanity-check procedure

## 1. Labels and citation format

| Label | Means | How to use it |
|---|---|---|
| official | The owner of the engine, crawler, framework or policy, about its own system | The mechanism is reliable. It gives no effect size |
| experiment | A controlled test: a lab pipeline, a matched test, or this skill's own run | The direction holds inside the setup. Transfer is uncertain |
| correlation | An observational dataset, usually from a vendor that sells a tool | A pattern, not a cause. Name the vendor |
| practitioner | An expert's case report, small sample or news report | Plausible and cheap to follow. Weak proof |
| contested | Credible sources disagree | State both sides, then pick the safe default |

Cite as: `<claim> (<label>, <source name>, <URL>)`. Name the vendor for any
correlation number. A number without a label and a source does not go in a
deliverable.

Facts marked `vf:<id>` change. Check that row in
`references/volatile-facts.md` before you state them.

## 2. Myths, with quotable sources

Quote the short text in the third column when you refuse a request.

| Claim | Verdict | Quote or finding | Source |
|---|---|---|---|
| You need llms.txt, AI text files or Markdown copies for Google AI features | False (official) | "You don't need to create new machine readable files, AI text files, markup, or Markdown to appear in Google Search ... as Google Search itself doesn't use them" | [Google AI guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) `vf:google-ai-guide-myths` |
| llms.txt raises AI citations anywhere | False (correlation, SE Ranking, ~300k domains) | "There's no correlation between AI citations and LLMs.txt" | [SE Ranking](https://seranking.com/blog/llms-txt/) |
| Chunk content into short blocks for AI | False (official) | "There's no requirement to break your content into tiny pieces for AI to better understand it" | [Google AI guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) |
| Rewrite pages "for AI" or add long-tail variants | False (official) | "You don't need to write in a specific way just for generative AI search" | same |
| Schema markup gets you cited by AI | False (official + experiment) | "there's no special schema.org markup you need to add"; Ahrefs: "Adding schema didn't boost citations on any platform" | same; [Ahrefs](https://ahrefs.com/blog/schema-ai-citations/) |
| FAQ or HowTo schema wins SERP space | False (official) | Both rich results are gone | [Search updates](https://developers.google.com/search/updates) `vf:faq-rich-results` `vf:howto-rich-results` |
| Mark up our G2, Capterra or Google rating as `aggregateRating` | Not allowed (official) | "Don't aggregate reviews or ratings from other websites" | [Review snippets](https://developers.google.com/search/docs/appearance/structured-data/review-snippet) `vf:review-snippet-rules` |
| Blocking GPTBot removes us from ChatGPT search | False (official) | OAI-SearchBot controls ChatGPT search; GPTBot controls training | [OpenAI bots](https://developers.openai.com/api/docs/bots) `vf:openai-bot-tokens` |
| Blocking Google-Extended removes us from AI Overviews | False (official) | "Google-Extended does not impact a site's inclusion in Google Search" | [Google crawlers](https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers) `vf:google-extended-scope` |
| robots.txt controls all AI access | False (official) | ChatGPT-User: "robots.txt rules may not apply"; Perplexity-User "generally ignores robots.txt rules"; CDN/WAF settings block independently | [OpenAI](https://developers.openai.com/api/docs/bots), [Perplexity](https://docs.perplexity.ai/guides/bots) |
| AI crawlers run JavaScript like Googlebot | False (correlation, Vercel/MERJ, 2024 data) | "none of the major AI crawlers currently render JavaScript" | [Vercel](https://vercel.com/blog/the-rise-of-the-ai-crawler) |
| Googlebot cannot index JavaScript sites | False (official + correlation) | Google renders with headless Chromium after a queue; Vercel/MERJ saw 100% of nextjs.org HTML pages fully rendered | [Google JS SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [Vercel](https://vercel.com/blog/how-google-handles-javascript-throughout-the-indexing-process) |
| `Disallow` removes a page from Google | False (official) | A disallowed page's robots rules "will not be found and will therefore be ignored". Use `noindex` and let it be crawled | [Robots meta](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) |
| Removing `noindex` with client JavaScript works | Unreliable (official) | "When Google encounters the noindex tag, it may skip rendering and JavaScript execution" | [Google JS SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) |
| Sitemap `priority` and `changefreq` matter | False (official) | "Google ignores `<priority>` and `<changefreq>` values" | [Sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) `vf:sitemap-hints` |
| Update the date (or add the year) to look fresh | Warning sign (official) | Google's self-assessment asks: "Are you changing the date of pages to make them seem fresh when the content has not substantially changed?" | [Helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content) |
| Pages need a target word count | False (official + correlation) | "preferred word count? (No, we don't.)"; Ahrefs: 0.04 Spearman between length and AIO citation | same; [Ahrefs](https://ahrefs.com/blog/short-vs-long-content-in-ai-overviews/) |
| A page per nearby town ranks us there | Doorway abuse (official) | "pages targeted at specific regions or cities that funnel users to one page" | [Spam policies](https://developers.google.com/search/docs/essentials/spam-policies) `vf:spam-doorways` |
| Template or AI-written pages at scale are fine if each has a unique name or city | Scaled content abuse (official) | Scaled content abuse applies "no matter how it's created" | same |
| Google penalises AI content as such | False (official) | Google rewards "high-quality content, however it is produced" | [Google blog, Feb 2023](https://developers.google.com/search/blog/2023/02/google-search-and-ai-content) |
| NPS-gate review asks (send only promoters to Google) | Not allowed (official) | Google bans asks that "selectively solicit positive reviews"; UK CMA: "encouraging just those who are satisfied to leave reviews" is cherry-picking | [Google policy](https://support.google.com/contributionpolicy/answer/7400114) `vf:google-review-policy`; [CMA208](https://www.gov.uk/government/publications/fake-reviews-cma208) `vf:uk-cma208` |
| Staff leaderboards for named reviews | Not allowed (official) | Banned: "Merchants requesting that staff solicit a certain number of reviews" and reviews "that identifies a staff member" | [Google policy](https://support.google.com/contributionpolicy/answer/7400114) |
| Disavow toxic links regularly | False (official) | "most sites will not need to use this tool" | [Disavow help](https://support.google.com/webmasters/answer/2648487) |
| Every site needs crawl-budget work | False (official) | The guide targets sites with 1 million+ pages, or 10,000+ pages that change daily | [Crawl budget](https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget) |
| You can track a "rank" in ChatGPT | False (correlation, SparkToro) | "<1 in 100 chance" of the same brand list in any two of 100 runs | [SparkToro](https://sparktoro.com/blog/new-research-ais-are-highly-inconsistent-when-recommending-brands-or-products-marketers-should-take-care-when-tracking-ai-visibility/) |
| A third-party tool sees Google's AI rankings | False (official) | "No third-party tool has access to our internal ranking or AI systems" | [Google AI guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) |
| A Lighthouse SEO score of 100 means AI crawlers can read the page | False (experiment) | Lighthouse audits the rendered DOM. A client-only SPA with 0 raw body words scored 0.92 | [Lighthouse SEO audits](https://developer.chrome.com/docs/lighthouse/seo/); skill test run 2026-10-03 |

## 3. The GEO paper, corrected

Aggarwal et al., "GEO", KDD 2024 ([arXiv](https://arxiv.org/html/2311.09735v3)).
Label: experiment.

- Setup: the generative engine answered from **fixed candidate sources**.
  Retrieval and reranking were not tested.
- Table 1, position-adjusted word count, baseline 19.5: Quotation Addition
  27.8 (+42.6%), Statistics Addition 25.9 (+32.8%), Cite Sources 24.9
  (+27.7%). Keyword Stuffing fell to 17.8. The paper rounds this to "boost
  visibility by up to 40%".
- The Perplexity run used 200 samples **uploaded as files**, not live web
  retrieval. Best gains there: 22% (word count) and 37% (subjective).
- The paper contains no "134-167 words", no "40-60 word answer" rule and no
  word-count target. Treat any such claim attributed to it as false.

Kim et al., "SAGEO Arena", KDD 2026 ([arXiv](https://arxiv.org/abs/2602.12187)),
retested GEO tactics in a full search pipeline. Label: experiment.

- Abstract: "existing approaches remain largely impractical under realistic
  conditions and often degrade performance in retrieval and reranking".
- Structural fields (title, headings, schema) "help mitigate these
  limitations".

What to tell a user: real statistics, quotes and citations are credibility
moves worth making when they are true. Rewriting body text to add them,
without new information, is not a ranking or citation lever.

## 4. Contested claims

State both sides. Use the safe default.

| Claim | For | Against | Safe default |
|---|---|---|---|
| AI-referred visitors convert far better | Single-site vendor reports | 54 sites, GA4: "LLM traffic did not convert significantly differently from Organic" ([Amsive](https://www.amsive.com/insights/seo/does-llm-traffic-convert-better-than-organic-a-new-data-backed-study/), correlation) | Measure the site's own conversion by channel |
| ChatGPT search runs on Bing | 87% of SearchGPT citations matched Bing's top results ([Seer](https://www.seerinteractive.com/insights/87-percent-of-searchgpt-citations-match-bings-top-results), correlation) | Profound reports ChatGPT's citations shifting from Bing towards Google's results ([Profound](https://www.tryprofound.com/blog/ai-search-shift), correlation) | Do not state it as settled. Bing visibility helps Copilot regardless `vf:bing-ai-performance` |
| AI Overviews do not reduce clicks | Google's public statements | Users clicked a result on 8% of visits with an AI summary vs 15% without ([Pew](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/), correlation, 900 US adults) | Plan for fewer clicks per impression |
| Ranking top 10 gets you into AI Overviews | Overlap was higher in 2025 | 38% of AIO-cited pages rank top 10 for the same query ([Ahrefs](https://ahrefs.com/blog/ai-overview-citations-top-10/), correlation) | Cover the buyer's sub-questions with distinct pages |
| Question-style headings and 120-180-word sections get more citations | SE Ranking: 120-180-word sections 4.6 vs 2.7 citations ([SE Ranking](https://seranking.com/blog/chatgpt-citation-factors/), correlation) | Google: no chunking needed (official) | Question headings only for real buyer questions; no length rule |

## 5. Study numbers, labelled

Use these in plan reviews and "says who?" answers only, never as rules.
Each is one vendor's sample.

| Number | Label | Source |
|---|---|---|
| Business websites were 93% of 116k unique cited domains and 42% of 1.97M local AI citations | correlation (BrightLocal, US-heavy) | [BrightLocal](https://www.brightlocal.com/research/local-ai-visibility-study/) |
| A brand's own self-ranked "best X" listicle was cited but the brand left out of the recommendation about 69% of the time (80 AIO prompts, B2B software) | practitioner (Lily Ray) | [Lily Ray](https://lilyraynyc.substack.com/p/why-calling-yourself-the-best-could) |
| Yelp filled 95.83% of ChatGPT business-card runs (2,879 runs) | practitioner (Steady Demand, US) | [Steady Demand](https://www.steadydemand.com/chatgpts-local-results-arent-coming-from-foursquare-and-probably-never-really-were/) `vf:yelp-openai` |
| 10.13% of ~300k domains had llms.txt; no citation effect | correlation (SE Ranking) | [SE Ranking](https://seranking.com/blog/llms-txt/) |
| 53.4% of AIO-cited pages are under 1,000 words | correlation (Ahrefs) | [Ahrefs](https://ahrefs.com/blog/short-vs-long-content-in-ai-overviews/) |

Do not use: Kevin Indig's "44% from the first 30% of a page" (paywalled,
unread), and any statistic you cannot open at its source.

## 6. Plan sanity-check procedure

Use for a marketing plan, an agency proposal or a GEO checklist.

1. List every claim and every proposed action as one row each.
2. Label each claim with section 1's labels. A statistic with no source is
   `unsourced`.
3. Trace each statistic to its primary source. Open it. If the number is not
   there, or the setup differs (lab vs live, one site vs many), mark it
   `misquoted`.
4. Label vendor statistics with the vendor's name, especially when the
   vendor sells the fix.
5. Check each action against section 2. A myth row means `cut`, with the
   quote.
6. Check each action for policy risk: doorway or city pages, template pages
   at scale, self-ranked listicles, bought links, review gating or
   incentives, invented facts. Each is `cut` or `change`.
7. Check fit to the team. A plan needs an owner and hours per item. Cut what
   nobody can maintain.
8. Mark each row `keep`, `change` (say how) or `cut` (say why), with its
   labelled source.
9. Put the kept items in gate order: crawler access and rendering first,
   then indexing, then pages, then off-site mentions.

Output one table: `item | claim | label | source | verdict | reason`.
