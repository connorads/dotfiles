# Pages: write or rewrite one page to rank and get cited

Use this file to write or rewrite a money page, or to judge a set of pages built from one template.
Gates: 1 Fetched, 2 Retrieved, 3 Quoted, 4 Recommended.

## Contents

1. Evidence labels
2. Rewrite checklist (the procedure)
3. Universal skeleton
4. Page types: pricing, alternatives, vs, use-case, integration, migration, guide
5. Contested items and safe defaults
6. Page sets at scale: the footprint test
7. Worked example: "Pulse vs Mailchimp"
8. Get recommended, not just cited

## 1. Evidence labels

Each rule carries one label, linked to its primary source.

| Label | Meaning | Use |
|---|---|---|
| official | The engine owner describes its own system | Mechanism is reliable; no effect size |
| experiment | Controlled test, lab or matched | Direction holds inside the setup; transfer is uncertain |
| correlation | Large-sample vendor study | Pattern, not cause; confounded by site authority |
| practitioner | Case study or small sample | Cheap to follow, weak proof |
| contested | Good sources disagree | State both sides; use the safe default |

Rules with no label are this skill's judgement. Say so if a user asks "says who?".

## 2. Rewrite checklist

Run the steps in order. Each step has a check. Stop at a failed check and fix it before you go on.

1. **Name the one buyer question.** Write it as one sentence, for example "How much does Pulse cost for 3 locations?". If the page answers several unrelated questions, split or cut.
   Check: the title and H1 answer to that sentence.
   Google calls separate pages for every query variation, fan-out queries included, scaled content abuse ([official](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)). One page per buyer question, not per keyword.

2. **Access gate.** Run `uv run scripts/probe.py <url>`, or `--base http://127.0.0.1:PORT` for a local build.
   Check: no `NO_H1_RAW`, `THIN_RAW_HTML` or `H1_ONLY_AFTER_JS`; the answer block, table and prices are in `raw/<slug>.html`.
   If this fails, stop copy work and fix gate 1 first. Microsoft says AI systems may not render content hidden in tabs or expandable menus, and warns against core facts only in PDFs or images ([official](https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers)).

3. **Title, H1 and meta name the entities.** Name both products, the category and the segment in plain words. Keep the title and H1 aligned.
   Check: no keyword strings, no year unless the content is year-specific.
   - Microsoft: alignment of title, H1 and description "improves both discoverability and confidence signals" ([official](https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers)).
   - Google asks whether the heading or title gives "a descriptive, helpful summary" and avoids exaggeration ([official](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)).
   - Titles and URLs that describe the topic got over 2x the ChatGPT citations of highly keyword-optimised ones ([correlation](https://seranking.com/blog/chatgpt-citation-factors/)).
   - In SAGEO Arena, structural fields drove retrieval and body text drove reranking and generation ([experiment](https://arxiv.org/html/2602.12187v2)). Put entities in fields and evidence in the body.

4. **Answer first.** The first 50-80 words answer the buyer question with a specific fact. Delete intros that restate the question.
   Check: read only the first paragraph. Does it answer the question?
   - SAGEO's best rewrite puts "the main claim ... at the start of the body" ([experiment](https://arxiv.org/html/2602.12187v2)).
   - "Clarity and summarization" had the strongest association with AI citations, +32.83% ([correlation](https://www.semrush.com/blog/content-optimization-ai-search-study/)).

5. **Information gain.** List what the top 5 Google results and one AI answer already say about the question. Mark each section of the page `commodity` or `new`.
   Check: the page has at least one `new` element: own data, a test, a dated screenshot, a named customer quote or a worked price example. If none is possible, stop and ask the user for first-party data. Do not publish filler.
   Google: non-commodity content will "likely influence your website's presence in generative AI search in the long run more than any of the other suggestions" ([official](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)).

6. **Facts, not adjectives.** Every "powerful", "easy" or "best-in-class" becomes a number, limit, time or named feature, or goes.
   Check: every fact traces to a file, a live page or the user. Anything else is `[verify: <what>]`. Never fill a price, quote, metric or competitor feature from memory.
   - Microsoft: replace terms like "innovative" with measurable facts ([official](https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers)).
   - Google's reviews guide: "Share quantitative measurements" ([official](https://developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews)).
   - AI models repeated specific fabricated details ("634 units in 2023") over a vague official statement ([experiment](https://ahrefs.com/blog/ai-vs-made-up-brand-experiment/)). A gap the page leaves gets filled by someone else, and a wrong fact gets quoted back.

7. **Self-contained sections, tight scope.** Each H2 opens with its own answer sentence. Use the entity's name where a pronoun would point outside the section. Cut sections that do not serve the buyer question.
   Check: lift any one section alone. Does it still make sense?
   - Microsoft: "Sentences that make sense even when pulled out of context" ([official](https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers)).
   - SAGEO replaces ambiguous pronouns with explicit subject references ([experiment](https://arxiv.org/html/2602.12187v2)).
   - Google: no requirement to "break your content into tiny pieces" ([official](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)). Self-contained is not the same as short.

8. **Real table for real comparisons.** Use an HTML `<table>`, values not ticks, a caption with the checked date, and a source link for each competitor value.
   Check: the table is in raw HTML, not an image or a JS-only widget.
   Microsoft names comparison tables as clean, reusable segments for feature comparisons ([official](https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers)). No controlled test isolates tables.

9. **Honest fit.** Label your product as yours. Add a "not for" statement. Let the competitor win where it really wins. Remove any forced rank with you at #1.
   Check: at least one row or section where another option is the better choice.
   - Google's reviews guide: "Discuss the benefits and drawbacks", "explain which might be best for certain uses or circumstances" ([official](https://developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews)).
   - A brand's self-promotional listicle was cited but the brand left out of the recommendation 69% of the time, 224 of 323, in AI Overviews ([practitioner](https://lilyraynyc.substack.com/p/why-calling-yourself-the-best-could)).

10. **Dates follow facts.** Change the visible "updated" date and sitemap `lastmod` only when facts change. Record the date you checked each competitor value.
    Check: the diff that changes the date also changes a fact.
    - Google lists "changing the date of pages to make them seem fresh when the content has not substantially changed" as a warning sign ([official](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)).
    - AI assistants cited content 25.7% fresher than organic results, but AI Overviews showed the strongest preference for older content ([correlation](https://ahrefs.com/blog/do-ai-assistants-prefer-to-cite-fresh-content/)). Real updates help; fake ones are a risk.

11. **Who, how, why; schema matches the page.** Add a real byline, a "how we compared" note and a correction contact. Every schema value appears in visible text.
    Check: `probe.py` shows no `VALUE_NOT_VISIBLE`, `SELF_SERVING_RATING` or `PLACEHOLDER_VALUE`.
    - Google's "Who, How, and Why" questions ([official](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)).
    - "Don't mark up content that is not visible to readers of the page" ([official](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)).
    - Reviews of the business on its own site, directly or through a third-party widget, are ineligible for star snippets ([official](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)).
    - Google: there is "no special schema.org markup you need to add" for AI features ([official](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)). Pages that added schema saw no citation gain ([experiment](https://ahrefs.com/blog/schema-ai-citations/)).

12. **Links and siblings.** Link the page from nav, pricing or a hub with an `<a href>`. Link on to the migration, integration and case pages. If sibling pages share the template, run the footprint test (§6).
    Check: inbound link present in raw HTML; footprint verdict recorded.
    Google crawls links reliably only as `<a>` with `href`; good anchor text is "descriptive, reasonably concise, and relevant" ([official](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)).

After publishing, note the date and measure: GSC queries and clicks for the URL, Bing AI Performance, and repeated prompt runs that record cited and recommended separately. One run proves nothing.

## 3. Universal skeleton

Every money page uses these blocks in this order. Drop a block only when the page type below says so.

| # | Block | Rule | Gate |
|---|---|---|---|
| 1 | `<title>` | `[Entity A] [relation] [Entity B or segment] \| Brand`. No year unless year-specific | 2 |
| 2 | Meta description | One sentence: the outcome and the main fact | 2 |
| 3 | H1 | Same meaning as the title | 2 |
| 4 | Answer block | 2-4 sentences under the H1 with a specific fact. Optional 3-5 key-fact bullets | 3 |
| 5 | Who it is for, and not for | Named segments, and where another option fits better | 4 |
| 6 | Evidence sections | One H2 per decision factor. Each opens with its answer sentence, then numbers, a screenshot or a quote | 3 |
| 7 | Comparison table | HTML `<table>`, real values, "Checked [date]" caption | 3 |
| 8 | Proof | Named customer quote with role and business, a metric, a case link. Real only | 4 |
| 9 | FAQ | Only real questions from sales calls, support tickets or People Also Ask. Visible text. FAQ rich-result status: volatile id `faq-rich-results` | 3 |
| 10 | Method and freshness | "How we compared", byline, updated date tied to a real change | 4 |
| 11 | CTA | Trial or demo, on topic | - |
| 12 | Internal links | `<a href>` with descriptive anchors to pricing, integration, migration and case pages | 1, 2 |

Gate 1 sits under every block: all of it must be in raw HTML (checklist step 2).

## 4. Page types

Each type lists its buyer question and the blocks it adds to the skeleton. Product names in brackets are placeholders.

### Pricing

Buyer question: "How much does [Brand] cost, and what do I get?"

- Answer block: starting price, billing unit (per seat, per location, per contact), currency, contract terms, trial. In text, not only in a graphic.
- Plan table: plan, price, limits, key features.
- What drives price: the variables and one worked example at a named size.
- Extra costs: setup, payment processing, add-ons, overage.
- Pricing FAQ: cancellation, annual vs monthly, discounts, migration cost.
- "Contact us" with no numbers gives a model nothing to quote, and third parties fill the gap ([experiment](https://ahrefs.com/blog/ai-vs-made-up-brand-experiment/)). If the user will not publish prices, publish what drives price and a range, and say why.

### Alternatives ("[Competitor] alternatives")

Buyer question: "What should I use instead of [Competitor], and why?"

- Answer block: why people leave [Competitor], from real reviews or sales calls, and the 3-6 options that fit, each with its best-fit segment in one line.
- Selection criteria before the list.
- Per option: what it is, best for, price as of a date, strengths, weaknesses, evidence. Your product is in the list and labelled as yours.
- Group by fit ("best for franchises", "best for a single site"), not a 1-N rank with you at #1.
- Disclosure: "We make [Brand]. Here is how we compared."
- Ray's 69% omission finding argues against self-ranking ([practitioner](https://lilyraynyc.substack.com/p/why-calling-yourself-the-best-could)). Grow and Convert reports such posts still work for clients, and defines the risky form as "force ranking your list and calling yourself the best"; their advice is to discuss your product first and say so openly ([practitioner](https://www.growandconvert.com/seo/self-promotional-listicles/)). Both sides support few, honest, detailed lists.

### Vs ("[Brand] vs [Competitor]")

Buyer question: "Which is better for me, A or B?"

- Title: `[Brand] vs [Competitor]: [the real difference] for [segment]`.
- Verdict block: "Choose [Competitor] if ... Choose [Brand] if ...", one concrete reason each.
- At-a-glance table: 8-15 decision factors, values not ticks, prices "as of [month year]", a source link per competitor value.
- One H2 per decision factor, each opening with its verdict sentence.
- Pricing at a named size; switching cost (time, data, contract exit).
- Method: who compared, when, on which plans; correction contact.
- Google's reviews guide: "Explain what sets something apart from its competitors" and "Focus on the most important decision-making factors" ([official](https://developers.google.com/search/docs/specialty/ecommerce/write-high-quality-reviews)).

### Use-case ("[Category] for [segment]")

Buyer question: "What is the best [category] for a [segment] like me?"

- Answer block: the segment's problem in its own words, and how the product solves it, with one metric.
- A 3-6 step workflow in that segment's context, with screenshots.
- Only the features that matter to this segment, each tied to a pain point.
- Proof from this segment; fit limits.
- If the page differs from its siblings only by `{{segment}}`, it fails the footprint test (§6).

### Integration ("[Brand] + [Tool]")

Buyer question: "Does [Brand] work with [Tool], and what syncs?"

- Answer block: yes or no, sync direction, which data, how often, which plans.
- Data mapping table: object, direction, frequency, limits.
- Setup steps, time to set up, permissions needed; limits and known issues.
- Link to the partner's own docs or marketplace listing.
- Generate integration pages from real integration data only. Google's scaled-content policy applies "no matter how it's created" ([official](https://developers.google.com/search/docs/essentials/spam-policies)).

### Migration ("Move from [Competitor] to [Brand]")

Buyer question: "How hard is it to switch, and what do I lose?"

- Answer block: time, cost, who does the work, what transfers and what does not.
- What-transfers table: data type, method, caveats.
- Export steps from [Competitor] that someone has actually tested, with dated screenshots. Untested steps are `[verify: tested export steps]`.
- Import steps, cut-over plan, one real migration story with numbers.

### Guide or blog post

Buyer question: the question the post answers, stated in the H1.

- Same answer-first and information-gain rules; length follows the question's scope.
- Link to the money page that the post's reader would need next.
- Google: "There's no ideal page length" ([official](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)).

Location and branch pages are a separate job with their own rules; do not build them from this file.

## 5. Contested items and safe defaults

| Item | Evidence on each side | Default |
|---|---|---|
| Question headings | Microsoft recommends question-style headings and Q&A blocks ([official](https://about.ads.microsoft.com/en/blog/post/october-2025/optimizing-your-content-for-inclusion-in-ai-search-answers)). Q&A format +25.45% ([correlation](https://www.semrush.com/blog/content-optimization-ai-search-study/)). Question-style headings averaged 3.4 citations vs 4.3 for plain ones ([correlation](https://seranking.com/blog/chatgpt-citation-factors/)) | Question headings only where the section answers a real buyer question |
| Page length | Google: "There's no ideal page length" ([official](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)) and no preferred word count ([official](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)). Spearman 0.04 between length and AI Overview citation; 53.4% of cited pages under 1,000 words ([correlation](https://ahrefs.com/blog/short-vs-long-content-in-ai-overviews/)). SE Ranking finds longer pages cited more ([correlation](https://seranking.com/blog/chatgpt-citation-factors/)) | No length target. One question per page; cover more sub-questions with more distinct pages, not padding |
| Section length | 120-180 words between headings had 70% more ChatGPT citations than sections under 50 words ([correlation](https://seranking.com/blog/chatgpt-citation-factors/)). Google: chunking not needed ([official](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)) | Focused sections; never split or pad to hit a count |
| Quotes, statistics, cited sources | The GEO paper reports visibility gains up to 40% from adding citations, quotations and statistics, with a fixed candidate set ([experiment](https://arxiv.org/html/2311.09735v3)). SAGEO, with retrieval and reranking included, found existing approaches "largely impractical" and often harmful to retrieval ([experiment](https://arxiv.org/abs/2602.12187)) | Add a quote or statistic only when it is real and the reader needs it. Never as a rewrite tactic |
| Promotional tone | "Non-promotional tone" -26.19% in cited pages; the direction is ambiguous ([correlation](https://www.semrush.com/blog/content-optimization-ai-search-study/)) | Persuasive is fine; unsupported superlatives are not |

## 6. Page sets at scale: the footprint test

Use this before you publish or keep 3 or more pages built from one template: vs, alternatives, integration, use-case or programmatic pages.

Why:

- Scaled content abuse is "many pages ... generated for the primary purpose of manipulating search rankings", "no matter how it's created" ([official](https://developers.google.com/search/docs/essentials/spam-policies)).
- Doorway abuse includes "substantially similar pages that are closer to search results than a clearly defined, browseable hierarchy" ([official](https://developers.google.com/search/docs/essentials/spam-policies)).
- One test of 225 programmatic pages saw 18% indexed after four weeks ([practitioner](https://arnjen.com/blog/programmatic-seo-225-pages-google-indexed-18-percent)).
- 220+ AI-content sites and subfolders: 54% lost 30% or more of peak organic traffic; 22% lost 75% or more ([practitioner](https://lilyraynyc.substack.com/p/it-works-until-it-doesnt-ai-content-risks)). One site with 51 comparison pages lost organic traffic and ChatGPT citations together ([practitioner](https://lilyraynyc.substack.com/p/your-geo-strategy-might-be-destroying)).

Run:

```sh
python3 scripts/footprint.py URL1 URL2 URL3 [--strip-tokens tokens.txt] [--threshold 0.6]
python3 scripts/footprint.py --files 'out/vs/*.html'
```

Put the swapped tokens in `--strip-tokens`: brand, competitor, segment, city. The script removes them and digits, then compares 5-word shingles between every pair. Exit 0 = no pair over the threshold; 1 = pairs over it; 2 = fewer than 2 pages fetched. Report exit 2 as `SKIPPED`, never as a pass.

Read the output:

| Result | Verdict |
|---|---|
| No pair over the threshold; each page has its own data | Publish |
| Pairs over the threshold, but each page has a different data table, test or quote | Read both pages. Pass only if a buyer would learn something different from each |
| Pairs over the threshold and unique share under 20% | Merge into one page, or enrich each with data only it has, then rerun |
| You cannot name one fact unique to a page | Do not publish it |

The 0.6 threshold is a calibrated starting value from this skill's own fixtures, not evidence about Google. A low score does not prove a page is useful; a high score proves the template carries the page.

## 7. Worked example: "Pulse vs Mailchimp"

Pulse is a fictional SaaS: marketing automation for businesses with several sites, such as clinics, salons or gyms. Mailchimp is a real competitor. Every Mailchimp value below is a placeholder. Check each one on Mailchimp's live pages, record the date, and link the source. Pulse values also come from the user's own facts file, never from memory.

### Weak outline

```text
Title: Pulse vs Mailchimp 2026 | Best Email Marketing Software | Pulse
H1:    Pulse vs Mailchimp: Which Is Better?
Intro (250 words): "In today's competitive landscape, choosing the right
       marketing platform is more important than ever..."
H2: What is Pulse?          (adjectives, feature list)
H2: What is Mailchimp?      (paraphrased from Mailchimp's homepage)
H2: Feature comparison      (image of ticks; Pulse ticks every row)
H2: Why Pulse is the #1 choice
H2: FAQ                     (5 keyword questions + FAQPage schema)
"Updated: [this month]"     (date bumped monthly, no content change)
```

### Diagnosis

| Problem | Gate | Checklist step |
|---|---|---|
| Year bait and "Best Email Marketing Software"; no segment, no real difference | 2 | 3 |
| 250-word preamble; the answer never appears | 2, 3 | 4 |
| "What is X" sections are commodity; the Mailchimp section is paraphrased | 3 | 5 |
| Comparison is an image; Pulse wins every row | 1, 3, 4 | 2, 8, 9 |
| "#1 choice" with no test | 4 | 9 |
| FAQ written for keywords, schema treated as the lever | - | 11 |
| Date bumped with no change | 4 | 10 |
| No author, method or sources | 4 | 11 |

### Strong outline

```text
<title> Pulse vs Mailchimp for multi-site businesses: per-location automation vs all-round email | Pulse
meta:   Mailchimp is a general email platform; Pulse runs per-location campaigns
        for businesses with several sites. Compare pricing at 5 locations,
        setup time and what each does not do.
H1:     Pulse vs Mailchimp: which does a business with several sites need?

Answer block (~70 words, under the H1):
  Mailchimp is a general email marketing platform [verify: Mailchimp
  positioning, source URL, date]. Pulse runs campaigns per location from one
  account. Choose Mailchimp if you have one site, need a free tier [verify:
  Mailchimp free plan exists and its limits] or a large template library.
  Choose Pulse if you run 3+ sites and each needs its own lists, sender and
  reports. Price at 5 sites, checked [date]: Mailchimp [verify: $X/month at
  N contacts]; Pulse [user facts: $Y/location/month].

H2: Which is right for you?
  Table "Best fit": business shape -> Mailchimp / Pulse / either.
  Mailchimp wins real rows, for example [verify: integration count],
  [verify: template library], [verify: free plan].

H2: At a glance  (HTML <table>, caption "Checked [date]; sources linked")
  Rows: core job, per-location lists, per-location sender, reporting by site,
  automation types, SMS, integrations, contract, setup time, price at 1 site,
  price at 5 sites, support hours. Values, not ticks. One source link per
  Mailchimp value.

H2: What a 5-site business pays
  Worked example: contacts, sends, add-ons, what is extra on each side.

H2: Running campaigns per location
  Opens with its verdict sentence. Dated screenshot. Own data only if the
  user supplies it: "[verify: N customers, metric, method]".

H2: Where Mailchimp is the better choice
  Plain statement of what Pulse does not do.

H2: Switching from Mailchimp
  What transfers, time to go live, contract exit; link /switch-from-mailchimp.

H2: What customers say
  2-3 named quotes from customers who used both [user facts only; else omit].

H2: FAQ  (visible text; questions from sales calls and support tickets)

H2: How we compared
  Who compared, plans used, dates, what we could not test,
  "We make Pulse", correction email.

Links: /pricing, /integrations, /switch-from-mailchimp, /customers/...
Schema: Organization and SoftwareApplication; every value visible on the page.
```

### Why each change

| Change | Gate | Source |
|---|---|---|
| Title names both entities, the segment and the real difference; no year | 2 | Step 3 |
| "Choose X if / choose Y if" answer block with dated prices | 2, 3 | Steps 4, 6 |
| Mailchimp wins real rows; a "where Mailchimp is better" section | 4 | Step 9 |
| HTML table with sources and a checked date | 1, 3 | Steps 2, 8 |
| Own data only from the user, with method | 3 | Steps 5, 6 |
| One H2 per decision factor, each opening with its verdict | 2, 3 | Step 7 |
| FAQ from real questions, no rich-result expectation | 3 | Skeleton block 9 |
| "How we compared" and bias statement | 4 | Step 11 |

The rewrite does not add length for its own sake, add FAQ schema, spin out "Pulse vs Mailchimp vs X vs Y" variants, or claim "#1".

## 8. Get recommended, not just cited

Gate 4 decides revenue on money pages. Cited is not recommended.

- When an Ahrefs page promoting its own conference was cited, the answer still skipped that conference 43% of the time, n=34 pages ([experiment](https://ahrefs.com/blog/self-promotional-content-ai-seo-experiment/)).
- Across 15,000 answers for one B2B client, a client page cited in 88% of runs went with a mention in 79%; at 44% cited, 25% mentioned. Grow and Convert: "you should produce content on your own site first ... and then go get 3rd party mentions" ([practitioner](https://www.growandconvert.com/research/third-party-citation-research/)).

**Consensus test.** Before you write, ask: "If a model ignored our domain, would the rest of the web still shortlist us for this question?" Ahrefs puts it as: "Would your brand look like a natural recommendation even if you hadn't written the page yourself?" ([experiment](https://ahrefs.com/blog/self-promotional-content-ai-seo-experiment/)). If the answer is no, the page alone will not pass gate 4.

Off-site levers, in order:

1. A first-party page that matches the buyer question closely (this file).
2. Profiles on the review platforms buyers in the category use. Domains with profiles on platforms such as Trustpilot, G2, Capterra and Yelp had 3x the chance of being a ChatGPT source ([correlation](https://seranking.com/blog/chatgpt-citation-factors/)). Ask before any review-request flow.
3. Inclusion in independent comparisons and category lists, earned with real data, not bought.
4. Named concepts and data that others can cite.

Do not buy or fake mentions. Google: "seeking inauthentic 'mentions' across the web isn't as helpful as it might seem" ([official](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)).
