# Local: multi-location businesses

Use this file for any business with physical premises that customers visit:
gyms and studios, dental and medical clinics, restaurants, retail stores,
salons, trades with a counter. It covers location pages, LocalBusiness
JSON-LD, Google Business Profile (GBP), reviews, listings, AI local answers and
booking links.

## Contents

1. Evidence labels and tiers
2. The brief
3. Location page template
4. LocalBusiness JSON-LD
5. Google Business Profile, ordered by evidence
6. Reviews: Google, UK CMA, US FTC
7. Listings and citations
8. AI local answers, per engine
9. Booking, ordering and action links
10. Chain or franchise vs independent

## 1. Evidence labels and tiers

| Label | Meaning |
|---|---|
| official | Google, Apple, Microsoft, schema.org or a regulator describes its own rule |
| experiment | Controlled test, usually small n; direction holds inside the setup |
| correlation | Vendor dataset; pattern, not cause |
| practitioner | Case report, survey of experts, news report |
| contested | Good sources disagree |

Rules with no label are this skill's judgement. Say so if asked "says who?".
Perishable facts sit behind a volatile id: read that row in
`references/volatile-facts.md` before you state the fact.

Work in three tiers. Finish a tier for every location before you start the
next one. Within a tier, start with the worst locations: fewest reviews, wrong
category, broken links, thinnest page.

| Tier | Contents | Done when |
|---|---|---|
| Foundation | One page per real premises, crawlable and server-rendered; one GBP per premises with true name, category, hours and links; JSON-LD matches the page | Access gate passes on every location page; no GBP rule broken |
| Priority | Unique page content (§3 test); services and attributes filled; one neutral review flow; replies | `footprint.py` passes across location pages |
| Competitive | Listings beyond the core set, local press, third-party "best of" lists, per-market AI prompt panels | Each item has a measured before and after |

Access gate: probe each location page before you write copy for it. If the raw
HTML lacks the h1, address and hours, fix rendering first.

## 2. The brief

Keep one file, `.seo/brief.md`, in the client repo. Create it only after the
user approves. It holds:

- Locations: name, address, phone, page URL, GBP place link, status (open,
  opening soon, closed).
- GBP: who owns the organisation account; who has manager access.
- Booking, ordering or appointment provider per location, and who owns each
  GBP action link.
- Tier reached per location.
- **Decisions withheld on purpose**, with the reason. Example: "No page for
  Riverside: no premises. Owner agreed 2026-xx-xx." Scheduled and later runs
  read this list and do not reopen it.

## 3. Location page template

URL: `/locations/{slug}/` (or `/clinics/`, `/restaurants/`, `/stores/`). One
page per premises customers can visit. A town with no premises gets no page
([official](https://developers.google.com/search/docs/essentials/spam-policies):
doorway abuse includes "multiple domain names or pages targeted at specific
regions or cities that funnel users to one page"). Link every location page
from a locator page with plain `<a href>` links, and list it in the sitemap.

Blocks, in order. Every fact is visible text in the raw HTML.

1. **H1**: brand plus area, and one line on what this site is ("Northfield
   Fitness Riverside - 24/7 gym with free parking").
2. **Name, address, phone**: name as on the storefront, full address, local
   number, map. Identical to GBP, Apple, Bing and the JSON-LD.
3. **Hours**: opening hours; staffed, kitchen or appointment hours where they
   differ; holiday hours.
4. **Primary action**: book, order, join or call for this location. Same URL as
   the GBP action link.
5. **Live inventory**: the data that changes per site - class timetable,
   menu, appointment slots, stock or services. Render it on the server from
   the provider's API. An iframe or client-only widget hides it from crawlers
   and AI fetchers.
6. **Facilities and services**: specific items (parking, step-free access,
   showers, sauna, private dining, wheelchair-accessible chairs, emergency
   appointments). Mirror them into GBP services and attributes.
7. **People**: real staff, coach, clinician or chef bios with qualifications.
8. **Getting here**: written directions, nearest station and bus, parking,
   cycle storage. This is also the honest home for "areas we serve".
9. **Photos**: this site only - entrance, interior, parking - with
   descriptive file names and alt text.
10. **Reviews**: recent real reviews from this location as visible text, chosen
    by a rule that ignores rating (for example "latest five"). Link to the GBP
    review page. Picking only 5-star reviews is cherry-picking under UK CMA
    guidance (§6).
11. **Local proof**: events, partners, local press, sponsorships.
12. **FAQ**: real customer questions, one or two sentences each, plain HTML.
    FAQ rich-result status: volatile id `faq-rich-results`. AI answers and
    Maps still read the text.
13. **Nearby locations**: links to the two or three nearest sites, not a list
    of towns.
14. **JSON-LD**: §4.

**Remove test.** Delete the city, address and map from two location pages.
If the rest reads the same, the template fails. Run `footprint.py` across all
location pages; the page differs in at least blocks 5, 7, 9 and 10. Template
plus city swap is the scaled-content pattern
([official](https://developers.google.com/search/docs/essentials/spam-policies));
200+ AI-written service-area pages were crawled and never indexed
([practitioner](https://www.sterlingsky.ca/danger-of-ai-generated-service-area-pages/)).

A single-premises business can use its home page as the location page. Add a
page per site from the second premises on.

## 4. LocalBusiness JSON-LD

Rules ([official](https://developers.google.com/search/docs/appearance/structured-data/local-business)):

- Use the most specific LocalBusiness subtype. Several types go in an array;
  `additionalType` is not supported.
- Required: `name`, `address`. Recommended: `geo` (at least 5 decimal
  places), `openingHoursSpecification`, `telephone` (with country code), `url`
  (this location's page), `priceRange` (under 100 characters), `menu` for food,
  `department` for real departments.
- `aggregateRating` and `review` are "only recommended for sites that capture
  reviews about other local businesses". A business marking up its own
  reviews, directly or through an embedded Google or Facebook review widget,
  is ineligible for stars
  ([official](https://developers.google.com/search/docs/appearance/structured-data/review-snippet)).
  Never add them to your own location page.
- `branchOf` is superseded by `parentOrganization`
  ([official](https://schema.org/branchOf)). Point `parentOrganization` at the
  brand's Organization `@id`.
- `name` is the brand as on the storefront, not "Brand - Area" (§5 name rule).
- Every value also appears as visible text on the page.

Subtypes ([official](https://schema.org/LocalBusiness), hierarchy checked per
type page):

| Business | Type | Parent chain |
|---|---|---|
| Gym, fitness or yoga studio | `ExerciseGym` | LocalBusiness > SportsActivityLocation |
| Full-service club with spa or pool | `HealthClub` | LocalBusiness > HealthAndBeautyBusiness (also SportsActivityLocation) |
| Dental practice | `Dentist` | LocalBusiness (also MedicalOrganization) |
| Medical clinic | `MedicalClinic` | LocalBusiness > MedicalBusiness |
| Restaurant | `Restaurant` | LocalBusiness > FoodEstablishment |
| Shop | `Store` or a subtype (`ClothingStore`, `HardwareStore`, ...) | LocalBusiness > Store |
| Hair salon | `HairSalon` | LocalBusiness > HealthAndBeautyBusiness |

Example for one dental location. Swap the type and type-specific fields for
other verticals:

```json
{
  "@context": "https://schema.org",
  "@type": "Dentist",
  "@id": "https://www.brightsmile.example/clinics/riverside/#location",
  "name": "Brightsmile Dental",
  "url": "https://www.brightsmile.example/clinics/riverside/",
  "parentOrganization": { "@id": "https://www.brightsmile.example/#org" },
  "telephone": "+44 113 496 0000",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "12 Example Road",
    "addressLocality": "Leeds",
    "postalCode": "LS1 4AA",
    "addressCountry": "GB"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": 53.79648, "longitude": -1.54785 },
  "openingHoursSpecification": [
    { "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      "opens": "08:30:00", "closes": "18:00:00" }
  ],
  "priceRange": "££"
}
```

Schema serves rich results and entity identity. It is not a local ranking or
AI lever: an expert survey ranks it low for both
([practitioner](https://whitespark.ca/local-search-ranking-factors/)).

## 5. Google Business Profile, ordered by evidence

Google ranks local results on relevance, distance and prominence. Prominence
draws on "how many websites link to your business and how many reviews you
have" ([official](https://support.google.com/business/answer/7091)). Work the
levers in this order.

**Name.** The real-world name "as used consistently on your storefront,
website, stationery". No taglines, store codes, service words or location
words; Google lists "Equinox SOHO" and "The Home Depot at Springfield" as not
acceptable, and extra words can get the profile suspended
([official](https://support.google.com/business/answer/3038177)). Every
location in a country uses the same name, unless a sub-brand is applied
consistently. Keywords in names correlate with top-3 pack presence (beauty:
15.59% exact match vs 2.50% none)
([correlation](https://whitespark.ca/blog/study-how-keywords-in-business-names-currently-impact-google-local-pack-rank-and-ai-search/)).
That is why competitors do it. Do not copy it; report it through Google.

**Primary category.** Pick the category that completes "This business IS a",
not "HAS a". Use as few as possible, as specific as possible, never as
keywords. All locations that offer the same service share one category
([official](https://support.google.com/business/answer/3038177)). Google's own
examples: "24-Hour Fitness" is Health Club, not Gym or Swimming Pool;
"Papa John's" is Pizza Delivery; "Wendy's" is Fast Food Restaurant. Expert
surveys rank the primary category as the top controllable factor
([practitioner](https://whitespark.ca/local-search-ranking-factors/)).

**Services.** Fill the predefined services first, then custom ones. Adding
services moved rankings in a small test
([experiment](https://www.sterlingsky.ca/services-in-google-business-profile-impact-ranking/)).

**Hours.** True customer-facing hours only. Google names the hours to use per
industry, for example restaurants use dine-in hours. Businesses whose hours
are only a schedule of classes or appointments "shouldn't provide hours"
([official](https://support.google.com/business/answer/3038177)). A class-only
studio lists no hours; a gym with open-gym access lists them. Fake 24-hour
hours break the guidelines. Being open at search time ranks high in expert
surveys ([practitioner](https://whitespark.ca/local-search-ranking-factors/)).

**Phone and website.** A local number under the business's control. The
website link goes to this location's page, never the home page or another
location ([official](https://support.google.com/business/answer/13769188)).

**Practitioners and departments.** Clinics and practices: a public-facing
practitioner at a shared location gets their own profile named with their
name only; the location gets its own profile. A department gets a profile only
when it is public-facing, has a different name and category, and usually its
own entrance ([official](https://support.google.com/business/answer/3038177)).
Never create profiles for a room, a class type or a service.

**Ownership.** 10+ locations of one business can bulk verify through one
business group. Agencies holding mixed businesses and service-area businesses
cannot ([official](https://support.google.com/business/answer/4490296)). The
brand owns the profiles; agencies and franchisees get manager access.

**Questions.** Q&A status and the replacement "Ask" feature: volatile id
`gbp-qa-status`
([practitioner](https://www.seroundtable.com/google-maps-qa-feature-ask-40594.html)).
Either way, put common customer questions (parking, access, price, booking
rules) into services, attributes, the description and the location page.

**Low or no rank effect.** Use these for conversion, not rank:

- Posts did not move rankings
  ([experiment](https://www.sterlingsky.ca/do-google-posts-impact-ranking/)).
- Uploading photos had "no measurable impact on ranking"
  ([experiment](https://www.sterlingsky.ca/photos-ranking-google-my-business/)).
- Geotagging photos is a myth
  ([practitioner](https://whitespark.ca/blog/geotagging-photos-is-a-local-seo-myth/)).

Every GBP edit is a write action: ask first (SKILL.md defaults).

## 6. Reviews: Google, UK CMA, US FTC

This table is the refusal source for any review feature you build or advise
on. When rules differ, the strictest applies to Google reviews.

| Flow | Google ([official](https://support.google.com/contributionpolicy/answer/7400114)) | UK CMA208 ([official](https://www.gov.uk/government/publications/fake-reviews-cma208)) | US 16 CFR 465 ([official](https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=465)) |
|---|---|---|---|
| Ask every customer the same way | Allowed: "solicit or encourage ... genuine experience" | Allowed | "Generalized solicitations to purchasers" are exempt |
| Incentive for any review | Banned: "payment, discounts, free goods and/or services" | Allowed only if disclosed as incentivised; concealed is banned | Banned when "conditioned ... on" a sentiment (465.4) |
| Ask only happy customers (NPS or rating gate) | Banned: "selectively solicit positive reviews" | Cherry-picking: "encouraging just those who are satisfied" | Not named in the rule text |
| Discourage negative reviews | Banned | Banned, including "arbitrarily stopping and starting review invitations" | Threats or false accusations to stop a review are banned (465.7a) |
| Require or pressure a review on premises | Banned | - | - |
| Ask for specific content ("mention the parking") | Banned | - | - |
| Staff review quotas; asks that name a staff member | Banned ("content that identifies a staff member") | - | - |
| Staff, owners or family reviewing | Conflict of interest, removed | Concealed incentivised if a trader asks staff to write one | Undisclosed insider reviews banned (465.5) |
| Show only good reviews on your own site | - | Cherry-picking: "selecting only favourable reviews to be presented" | Banned to imply shown reviews are all when low ratings are suppressed (465.7b) |
| Fake or AI-written reviews | Banned | Banned | Banned (465.2) |
| Your own "independent" review site | - | - | Banned when misrepresented (465.6) |

The staff clauses are recent: volatile id `google-review-policy`.

**The flow to build.** One neutral ask to every customer after a real visit,
by email, SMS, receipt or end of chat, with Google's review link. No score
first, no branch on a score, no reward, no suggested wording. Google's own
help lists receipts, thank-you emails, end of chat and a displayed in-store
QR code as ways to share the link
([official](https://support.google.com/business/answer/16816815)). A passive
QR on display is allowed; staff asking at the counter is pressure.

**Pace it per location.** Google can stop new reviews, unpublish existing
ones and show a warning on a profile it finds in breach
([official](https://support.google.com/business/answer/14114287)); durations:
volatile id `gbp-review-restrictions`. Blocks cluster with on-site QR asks and
sudden volume: one case ran at 2.75x baseline for about three months, then lost
342 reviews (57.5%); every tracked block lasted the full 30 days despite
appeals ([practitioner](https://www.sterlingsky.ca/review-posting-blocks-are-surging-heres-the-data-plus-the-patterns-behind-them/)).
So send asks in steady daily batches, never a blast to the whole customer
list, and alert when one location's daily volume jumps well above its own
baseline.

**Replies.** Reply to reviews, short, specific and not promotional; never
share a reviewer's private details
([official](https://support.google.com/business/answer/3474122)). In 12,752
rejected owner replies, 92.6% answered 5-star reviews and the average was
posted about 50 days late
([correlation, vendor](https://www.seroundtable.com/rejected-google-review-replies-analysis-41457.html)).
Draft replies per review, soon after it lands; never one template.

**Schema.** No self-serving `aggregateRating` (§4).

## 7. Listings and citations

1. Claim and keep identical: GBP, Apple (portal name and status: volatile id
   `apple-business`,
   [official](https://www.apple.com/newsroom/2026/03/introducing-apple-business-a-new-all-in-one-platform-for-businesses-of-all-sizes/)),
   Bing Places (portal location: volatile id `bing-places`; it imports
   listings from Google,
   [official](https://blogs.bing.com/search/2025/10/Introducing-the-New-Bing-Places-for-Business-Built-for-Business-Owners,-Powered-by-Research/)),
   Yelp and Facebook. Add the vertical's main directory (booking marketplace,
   healthcare directory, delivery or reservation platform).
2. Stop there for structured citations. 50 citations built at once gave no
   pack lift, and 2 of 50 stayed indexed after six months; "10 to 20
   citations is usually the maximum you can get Google to keep indexed"
   ([experiment](https://www.sterlingsky.ca/how-many-citations-does-small-business-need/)).
   Refuse bulk citation packages.
3. Then earn unstructured mentions: independent "best {category} in {city}"
   lists, local press, partners, events. Survey experts recommend "best of"
   lists for AI visibility ([practitioner](https://whitespark.ca/local-search-ranking-factors/)).
   Never publish your own "best" list with yourself first.

Check name, address and phone across GBP, page, JSON-LD and each listing.
Any difference is a finding.

## 8. AI local answers, per engine

All the evidence below is cross-industry. Market mix is not stated or is
US-heavy, so treat transfer to other markets as uncertain. Before you
prioritise a listing for AI, run a per-market prompt panel: repeated runs per
prompt, several locations, cited and recommended counted apart.

| Finding | Label |
|---|---|
| Across ChatGPT, AI Mode and AI Overviews, GBP was 28.63% of citations, Yelp 9.53%, Facebook 2.23%, Tripadvisor 1.79% ([source](https://www.brightlocal.com/research/local-ai-visibility-study/)) | correlation, vendor, 1,342 locations |
| Business websites were 93% of cited domains and 42% of citations; the location page is the fact sheet AI reads (same source) | correlation, vendor |
| ChatGPT hardly uses GBP; it overlaps only 19-20% with the Google surfaces (same source) | correlation, vendor |
| Same prompt repeated: 21-33% overlap between result sets, about 50% persistence (same source) | correlation, vendor |
| Yelp licenses reviews, photos and business details to OpenAI for ChatGPT ([source](https://finance.yahoo.com/media-advertising/articles/exclusive-yelp-deal-pushes-local-130005436.html)); volatile id `yelp-openai` | practitioner (news report) |
| Yelp was attached to 95.83% of ChatGPT business-card runs and Foursquare to 0%; the "60-70% Foursquare" claim came from 50 prompts in five Spanish cities ([source](https://www.steadydemand.com/chatgpts-local-results-arent-coming-from-foursquare-and-probably-never-really-were/)) | correlation, 2,880 prompts |

What to do with it:

- Google AI surfaces: a complete, accurate GBP and a fact-rich location page.
- ChatGPT: accurate Yelp and Bing listings and the location page. Where Yelp is
  weak in a market, check with the prompt panel before you spend on it.
- All engines: independent "best of" lists and local press (§7).
- Never report AI visibility from one screenshot or one run.

## 9. Booking, ordering and action links

GBP action links (book, order, reserve) must
([official](https://support.google.com/business/answer/13769188)):

- lead to a page for this specific location, not a general or another
  location's page;
- let the customer complete the action; social, messaging, app-store links and
  link shorteners are not allowed;
- load fully for Google's verifier. `Google-BusinessLinkVerification` ignores
  robots.txt, and links are removed if the site blocks that UA, rate-limits,
  shows a CAPTCHA or login, blocks IPs, or cloaks. Check with
  `probe.py --ua gbp-verifier` and check the CDN/WAF bot rules.

Each domain gets one link and each action type at most 20. A third-party
provider can add its own link
([official](https://support.google.com/business/answer/13769188)). Audit
who owns each action link per location. A marketplace or reseller link can
send the booking, and its margin, elsewhere.

Reserve with Google adds a native Book button for supported providers. Partner
list: volatile id `reserve-with-google-partners`
([official](https://www.google.com/maps/reserve/partners)). Treat it as a
conversion feature; no source shows a rank effect.

## 10. Chain or franchise vs independent

Rules from the official name, category, links and doorway policies; the
rest is practitioner judgement.

| Concern | Chain or franchise (10+ sites) | Independent (1-3 sites) |
|---|---|---|
| GBP ownership | Brand's business group owns all profiles; franchisees and agencies are managers; bulk verify | Owner keeps primary ownership; agency gets manager access only |
| Name | Brand only, same across the country; a sub-brand only if every storefront uses it | Real-world name; no keywords even if competitors add them |
| Website | One brand domain with `/locations/{slug}/`; near-identical franchisee microsites match the doorway pattern | Home page serves one site; add location pages from the second site |
| Content | Central template for shared facts; each site supplies photos, people, events, partners | Local detail is easy; links and listings are the gap |
| Reviews | Automated asks across many sites: highest risk of volume spikes and templated replies; pace and reply per location | Low volume; long gaps between reviews are the risk |
| Listings | A listings feed or tool pushes to Google, Apple, Bing, Yelp, Facebook | Claim the core set by hand |
| AI | Brand entity is strong; locations compete with each other | Must earn local lists and press to be named |
