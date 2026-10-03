# Measurement

Each source below sees one slice of search and AI visibility. Name the source
for every number and state what it cannot show. Never merge sources into a
0-100 score.

Evidence labels: `official` (the vendor's own docs), `experiment` (a
controlled test), `correlation` (an observational dataset), `practitioner`
(an expert's report or this skill's starting threshold), `contested`.
`vf:<id>` marks a perishable fact. Check its row in `volatile-facts.md`
before you state it.

## Contents

- Source map
- 1. Search Console procedures: totals, artefacts, seasonality,
  cannibalisation, CTR gap, striking distance, decay, legacy demand
- 2. Drop diagnosis order
- 3. Search Console access and AI reports
- 4. Bing Webmaster AI Performance
- 5. GA4
- 6. Self-reported attribution
- 7. Prompt panels
- 8. Paid AI-visibility trackers
- 9. Scheduled runs

## Source map

| Source | Shows | Cannot show | Evidence |
|---|---|---|---|
| GSC Performance (Search) | Google clicks, impressions, CTR, position by query, page, date, country, device | Anonymised queries in the query table; AI Overview and AI Mode traffic as a separate line (it is inside Web totals) | official [perf report](https://support.google.com/webmasters/answer/7576553) |
| GSC Generative AI performance report | Impressions in AI Overviews and AI Mode, by page, country, date, device | Queries; clicks; data before rollout `vf:gsc-genai-report` | official [report help](https://support.google.com/webmasters/answer/16984139) |
| Bing Webmaster AI Performance | Citation counts in Copilot, Bing AI summaries and some partner surfaces; sampled grounding queries; citations per URL | Clicks, traffic, placement in the answer; ChatGPT, Perplexity, Gemini or Google `vf:bing-ai-performance` | official [Bing help](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c) |
| GA4 AI Assistant channel | Sessions with a referrer on GA4's AI assistant list | AI Overviews and AI Mode (in Organic Search); visits with no referrer (in Direct) `vf:ga4-ai-assistant-channel` | official [GA4 channels](https://support.google.com/analytics/answer/9756891) |
| "How did you hear about us?" | What the buyer remembers, including AI use that left no referrer | Volume or which engine cited what | practitioner (this skill's default) |
| Prompt panel | Appearance rate per engine for a fixed prompt set | Real user prompts; real traffic | experiment [SparkToro](https://sparktoro.com/blog/new-research-ais-are-highly-inconsistent-when-recommending-brands-or-products-marketers-should-take-care-when-tracking-ai-visibility/) |

## 1. Search Console procedures

Work from an export or API rows saved to a file. Do the arithmetic in a
spreadsheet or a short `python3` snippet, never in prose. Tag every number
`Measured (<file>)`. Each procedure below is one section of the digest.

### 1.1 Totals

1. Take site totals from the chart, the `Dates` export, or API rows grouped by
   `date` or by no dimension.
2. Never sum the query table. GSC leaves anonymised (rare) queries out of the
   query table but keeps them in chart totals, and the table shows at most
   1,000 rows. official
   [discrepancies](https://support.google.com/webmasters/answer/17010575)
3. Print both numbers when the user has only a query export: "date total X,
   query-row sum Y, gap from anonymised and truncated rows". Summed query rows
   produced a false "0 clicks" site report in one agent skill. practitioner
   [claude-seo#130](https://github.com/AgriciDaniel/claude-seo/issues/130)
4. A page or Search appearance filter switches aggregation from property to
   page, so filtered totals can exceed the unfiltered chart. official (same
   URL)
5. For a complete query list, use bulk data export to BigQuery. official
   [dimensions](https://support.google.com/webmasters/answer/17011259)

### 1.2 Reporting artefacts

Rule out reporting changes before you call a drop real. Read the
[Data anomalies page](https://support.google.com/webmasters/answer/6211453)
for every window you compare. official

- **Impressions logging error.** Google lists an error that misreported
  impressions, CTR and average position for a long window. Clicks were not
  affected. Compare clicks, not impressions, across that window.
  `vf:gsc-impressions-logging-2025` official (Data anomalies page)
- **`num=100` change.** Google stopped honouring the `&num=100` results
  parameter. Rank-tracker scrapers had inflated desktop impressions on deep
  positions. After the change, impressions fell and average position
  improved on most sites with no change in real demand. `vf:gsc-num100`
  practitioner [Brodie Clark](https://brodieclark.com/the-great-decoupling-num100/),
  [SET](https://www.seroundtable.com/google-search-console-reporting-off-40106.html)
- **Rich-result removals.** A removed result type drops its Search appearance
  impressions. The Data anomalies page lists these too. official
- When a compared window spans an artefact, print `ARTEFACT (<name>):
  impressions and position not comparable` and judge on clicks.

### 1.3 Seasonality

1. Set the date range to the last 16 months, or compare year over year. If
   the drop also happened at the same time last year, it is seasonal.
   official [traffic drops](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops)
2. Check the top lost queries in Google Trends to see if demand fell across
   the web. official (same URL)
3. Data shorter than 13 months gives `SEASONALITY UNCHECKED`, never "not
   seasonal".

### 1.4 Cannibalisation

1. Get query x page rows (API with `dimensions: ["query","page"]`, or bulk
   export). In the UI, filter one query, then open the Pages tab.
2. Flag a query where 2 or more pages each take at least 10% of its
   impressions. practitioner (starting threshold)
3. From a UI export without query x page pairs, the label is `suspected`.
   Confirm from paired rows.
4. Read both pages before you propose a merge, a redirect or a re-target.
   Two pages that answer different intents are not cannibals.

### 1.5 CTR gap

1. Bucket rows by rounded position (1, 2, 3, 4-5, 6-10).
2. Compute the site's own median CTR per bucket from its own rows. Never use
   an industry CTR curve.
3. Flag rows at position 10 or better with CTR below half their bucket
   median. practitioner (starting threshold)
4. Before rewriting the title, check the SERP for that query. An AI Overview
   takes one position and every link in it shares that position, so CTR
   for those rows reads low. official
   [impressions and position](https://support.google.com/webmasters/answer/7042828)

### 1.6 Striking distance

1. Exclude branded queries. Use GSC's branded query filter where it exists
   `vf:gsc-branded-filter`, otherwise a brand regex the user confirms.
   official [dimensions](https://support.google.com/webmasters/answer/17011259)
2. Keep rows at position 4-20 with impressions at or above the site's 75th
   percentile. practitioner (starting threshold)
3. Group the rows by page. One page with many such queries is a single
   rewrite job, not many.

### 1.7 Decay

1. Compare each page's clicks with the previous window and with the same
   window last year.
2. Flag pages down 30% or more on both. practitioner (starting threshold)
3. A page down on one comparison only is seasonal or noise until shown
   otherwise.

### 1.8 Legacy demand

1. List the site's current terms: H1s and titles from the probe output, plus
   the product's own nouns.
2. Flag clicked queries that share no term with that list.
3. After a pivot, report these as past demand. Do not chase them with new
   pages unless the user still sells that thing. "Search history describes
   past demand, not product direction." practitioner
   [iannuttall/seo](https://github.com/iannuttall/seo/blob/main/skills/seo/SKILL.md)

## 2. Drop diagnosis order

Stop at the first step that explains the drop.

1. **Clicks, not impressions.** Impressions carry the artefacts in 1.2.
2. **Year over year.** Same dip last year means seasonality (1.3).
3. **Locate it.** By page or template, query group, country, device, search
   type, and the first day of the drop. Sort pages by "Clicks difference".
   Site-wide: open the Page indexing report. A page group: run URL Inspection
   on a few pages. official
   [traffic drops](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops)
4. **Your changes on that date.** Deploys, migrations, redirects, robots.txt,
   canonical or rendering changes. Probe the affected URLs now.
5. **Google's side.** The
   [Search Status Dashboard](https://status.search.google.com/products/rGHU1u87FJnkP6W2GwMi/history),
   Manual Actions and Security Issues reports. official (same doc)
6. **Only then content.** A small position loss (2 to 4) needs no radical
   change. A large loss across many queries calls for a site-wide quality
   review. official (same doc)

Ask the user to add a Search Console annotation on each deploy date. The
annotation shows on the Performance chart. official
[common tasks](https://support.google.com/webmasters/answer/17010961)

## 3. Search Console access and AI reports

### Getting the data

- **UI export.** Every Performance tab exports chart and table data. Values
  shown as `~` or `-` export as zero, so a zero in an export is not a
  measured zero. official
  [perf report](https://support.google.com/webmasters/answer/7576553)
  List the file names you actually received. Do not assume them.
- **API.** `searchanalytics.query` needs the `webmasters.readonly` scope.
  `rowLimit` is 1-25,000 (default 1,000); page with `startRow`. Rows grouped
  by `date` sort oldest first. Queries grouped by page and query cost the
  most load quota. official
  [query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query),
  [limits](https://developers.google.com/webmaster-tools/limits)

  ```sh
  curl -s -X POST -H "Authorization: Bearer $GSC_TOKEN" -H "Content-Type: application/json" \
    "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query" \
    -d '{"startDate":"START","endDate":"END","dimensions":["date"],"type":"web"}' > gsc-dates.json
  ```

  The user supplies the token. Never print it. Without a token, mark API
  sections `NEEDS-DATA (GSC API access)` and use the UI export.

### Generative AI performance report

- It reports impressions for AI Overviews and AI Mode by page, country, date
  and device. It has no query dimension, and its help page describes no
  clicks. `vf:gsc-genai-report` official
  [report help](https://support.google.com/webmasters/answer/16984139)
- Its data also sits inside the Web search type of the main Performance
  report. Never add the two together. official (same URL)
- AI Overview and AI Mode clicks count as Google Search clicks. In GA4 they
  land in Organic Search. official
  [impressions](https://support.google.com/webmasters/answer/7042828),
  [GA4 channels](https://support.google.com/analytics/answer/9756891)
- The searchanalytics API `type` values are `web`, `image`, `video`, `news`,
  `discover` and `googleNews`. None is generative AI, so export this report
  from the UI. official
  [query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- A separate Generative AI report covers Discover. official (report help)

### Missing report: check the Search generative AI control

1. Open Settings > Search generative AI. `vf:gsc-genai-control`
2. "Exclude" removes the site from AI Overviews, AI Mode and generative AI in
   Discover, with no impressions or traffic from them. It does not stop AI
   training. Google-Extended controls training. official
   [control](https://support.google.com/webmasters/answer/16908024)
3. A child property inherits its parent's choice unless someone set it by
   hand. Check the parent too. official (same URL)
4. Otherwise the report is absent because of low AI impressions or an
   incomplete rollout. Say so, and do not read the absence as zero. official
   [report help](https://support.google.com/webmasters/answer/16984139)
5. Changing the control is a write action. Ask first.

## 4. Bing Webmaster AI Performance

The only first-party citation counts from an AI answer engine.
`vf:bing-ai-performance` official
[launch post](https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview),
[help](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c)

1. Ask the user to export grounding queries, page citations and the time
   series. Exports are CSV or Excel. Filters apply to exports. official
   (help)
2. Read grounding queries as the retrieval phrases the engine used, grouped
   and shortened. They are not user prompts. official (help)
3. The data is sampled. Totals differ across views, and the same query x page
   pair can show different counts depending on the filter order. Never
   reconcile them to the unit. official (help)
4. Citations are not clicks or traffic. official (help)
5. Intents, Topics, Citation Share and Compare views add context.
   Citation Share is the site's share of all citations for one grounding
   query. It names no competitors. `vf:bing-ai-performance` official
   [June post](https://blogs.bing.com/search/2026/6/New-AI-Visibility-Insights-in-Bing-Webmaster-Tools-Intents-Topics-Citation-Share-Compare/)
6. No AI Performance method appears in the Bing Webmaster API reference. Use
   the UI export. `vf:bing-ai-performance-api` official
   [API reference](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi?view=bing-webmaster-dotnet)
7. Use the data to pick pages: grounding queries with citations to a weak
   page, and money pages with zero citations.

## 5. GA4

1. Check the default **AI Assistant** channel before you build anything. GA4
   sets medium `ai-assistant` and campaign `(ai-assistant)` when the referrer
   matches its list of AI assistants. `vf:ga4-ai-assistant-channel` official
   [GA4 channels](https://support.google.com/analytics/answer/9756891)
2. It excludes AI Overviews and AI Mode. Those arrive in Organic Search.
   Measure them in GSC (section 3). official (same URL)
3. A visit with no referrer cannot match the list. It lands in Direct.
   official (Direct = source `(direct)`, same URL). App and copy-paste
   visits often send no referrer. practitioner (not measured here)
4. Add a custom channel only for an AI source you can see in the session
   source report that the default channel misses. Place it above Referral:
   traffic goes to the first channel it matches. Custom channel groups apply
   to past data. official
   [custom channel groups](https://support.google.com/analytics/answer/13051316)
5. Do not copy Google's example regex from that page. It starts `^.*ai|`,
   which matches every source containing "ai", such as `mail` sources. Match
   exact hostnames instead. official (read on that page)

## 6. Self-reported attribution

Add a "How did you hear about us?" field to signup, booking and demo forms.
Use a picklist with an explicit "ChatGPT / AI assistant" option and a
free-text "Other". Report it monthly next to the GA4 AI Assistant channel.
It is the only source that catches AI influence with no referrer (section 5,
step 3). practitioner (this skill's default)

## 7. Prompt panels

AI answers vary from run to run. In a 2,961-run panel across ChatGPT, Claude
and Google AI, two responses gave the same brand list less than 1 time in
100. Appearance rate across many runs was the usable metric; rank position
was not. experiment
[SparkToro](https://sparktoro.com/blog/new-research-ais-are-highly-inconsistent-when-recommending-brands-or-products-marketers-should-take-care-when-tracking-ai-visibility/)

1. **Fix the prompt set.** Build it from GSC queries, Bing grounding queries
   and the customer's own words from sales calls or reviews. Write it to a
   file. Keep the wording neutral and unchanged between runs. practitioner
   [account-canvas-hq#16](https://github.com/linliangz/account-canvas-hq/issues/16)
2. **Run each prompt N times per engine** in clean sessions: signed out or a
   fresh profile, no memory, location stated in the prompt for local
   queries. Record engine, date, run count and the raw answer text to a file.
3. **Score two things separately** per run: `cited` (a link to the site) and
   `recommended` (the brand is named as a fit). Cited is not recommended.
4. **Check brand matches by hand** on a sample. A generic word in the brand
   name ("Core", "Pulse") produces false positives.
5. **Report `k of n runs`** per prompt and engine. Compute rates and
   intervals in code:

   ```sh
   python3 -c "import math,sys;k,n=map(int,sys.argv[1:]);z=1.96;p=k/n;d=1+z*z/n;c=(p+z*z/(2*n))/d;h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;print(f'{k}/{n} = {p:.0%} (95% CI {c-h:.0%}-{c+h:.0%})')" 7 20
   ```

   Two rates whose intervals overlap are not a change.
6. Never report a single run, a screenshot or a personalised answer as a
   result.

## 8. Paid AI-visibility trackers

Ask the vendor these questions before the user buys. Write each answer next
to the price.

| Question | Why it matters |
|---|---|
| Who writes the prompt set, how many prompts, and can we see and edit it? | The prompt set decides the score |
| How many runs per prompt per engine per period? | One run per prompt measures noise |
| Which engines and model versions, via API or the consumer app? | API answers may differ from what users see; this is an open question in the SparkToro study |
| Signed in or out, which location and language? | Local and personalised answers change |
| Does it separate cited from recommended? | Citation without recommendation is the common case |
| Does it report a "rank" or "position" in AI answers? | Order is near-random between runs; a rank metric is not evidence |
| Can we export raw answers? | Without them, no number can be checked |

Google: no third-party tool has access to its internal ranking or AI
systems. official
[AI optimisation guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
If the user already pays for a tracker, report its appearance rates with
run counts and prompt set. Do not replace it.

## 9. Scheduled runs

A recurring job reruns, diffs and reports. It never acts beyond SEO paths.

1. **Rerun:** the probe on the same URL list; the GSC date totals, decay and
   striking-distance procedures over the same windows; the fixed prompt set
   with the same run count.
2. **Diff** against the last run's saved output: new probe flags, pages
   crossing the decay threshold, prompt rates whose intervals no longer
   overlap.
3. **Output:** one issue or PR with the diff and evidence files. Touch only
   SEO files. Never merge. A scheduled SEO branch that deleted deploy
   workflows was stopped only by a failed auto-merge. practitioner
   [sobitas#224](https://github.com/declared-as-ala/sobitas-project/issues/224)
4. **Never** change the prompt wording, the thresholds or the brand regex
   between runs without saying so in the report. A changed method breaks
   the comparison.
5. A missing source in a run is `SKIPPED (<reason>)`, never zero.
