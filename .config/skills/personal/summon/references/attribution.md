# Attribution grammar

The rule every quotation in a persona file follows. `scripts/check-quotes.py` enforces the
machine-checkable parts; the rest is on the author.

## Why it exists

Quotation marks are a claim about verbatim reproduction. A source *string* is not evidence of
one - "various interviews" and "attributed to X" are admissions of no source wearing the
costume of a citation, and they are what let a dossier hand one person's words to another.

The failure has a measurable shape: attribution accuracy falls off with how often a person is
quoted in training data, and the dominant error is not invention but **identifier hijacking** -
real content attached to the wrong real person, drifting towards the more famous name in the
same field. Expect the plausible failure, not the obvious one.

## Line shape

An attribution line sits directly beneath the quote and starts with `-- ` and a status token:

```text
> "Quote text, verbatim, 50 words or fewer."
-- <status> | <source> | <url>
```

## Status - a closed set

Status is *stored*, never inferred from whether a source string happens to exist. Delivery is
then a pure function of it.

| Status | Means | Delivered as |
|---|---|---|
| `verbatim` | Primary source, wording checked against it | A quote, in quotation marks |
| `attributed` | Reputable secondary only | A quote, only if the secondary is named in the same sentence ("as quoted in Wired, 2014") |
| `paraphrase` | Documented position, summarised | Never in quotation marks |
| `extrapolation` | Derived by the skill, not documented | Never quoted; flagged as extrapolation |
| `misattributed` | Recorded here as wrongly credited | Never delivered as theirs; needs `actual:` |

A quote with no status token is legacy: treated as `paraphrase` at delivery, and counted
against the file's baseline until someone sources or drops it.

## What `verbatim` requires

A pointer that resolves, by source type:

| Type | Required |
|---|---|
| Blog, post, article, video, podcast | A URL. Use a `#:~:text=` fragment where the page supports it |
| Video, podcast, talk recording | A timestamp too - `MM:SS`, or `H:MM:SS` past an hour |
| Book | Title, edition and page. Editions repaginate, so a page without an edition is unverifiable |
| Talk | Title, venue, year and timestamp |
| Repo | `owner/repo#123` and a date |

Interviews are `attributed`, not `verbatim`: the interviewer's transcription sits between you
and the words.

## Banned - these fail the lint

`various interviews`, `various talks`, `his blog`, `attributed to`, `widely quoted`,
`often quoted as`, `variously reported`, `in an interview` with no publication, a bare topic
label (`-- on content philosophy`), a book with no page, a talk with no timestamp, a podcast
with no episode or date.

Every one of these was in this corpus. `-- various interviews` is what waved through a Steve
Jobs line delivered as Jony Ive's, and `-- on content philosophy` is what waved through a
rival marketer's trademark phrase.

## Inline quotes inherit from a twin

A quotation embedded in prose makes the same claim as one that owns its line, so it carries
the same obligation. Restating a quote in prose is how the corpus is written, though, and
re-citing it every time would be noise. So an inline string of 25 characters or more passes
when its text matches a line-level quote **in the same file**, and inherits that quote's
status; one with no twin anywhere in the file is a violation.

The practical rule when writing: **source a line once under `## Sourced Quotes`, then quote it
exactly wherever you restate it.** Matching is exact after folding case, accents, punctuation
and quote glyphs - an excerpt of a longer sourced sentence does *not* inherit, because
excerpting is where splices and clause reversals enter. Quote the whole sourced sentence, give
the excerpt its own sourced entry, or drop the marks.

Not treated as quotations: strings under 25 characters (scare-quoting a term of art claims
nothing about reproducing a sentence), code fences and inline code spans, and article titles on
an attribution line, which are metadata rather than the persona's voice.

This is the widest part of the gate and the last to be built. `rich-hickey.md`'s
`## Contrarian Takes` were fabricated quotes written entirely in this syntax - including a
Haskell line that inverts his recorded position - and the line-level rule could not see one of
them.

## Rules a machine cannot check

Get these right yourself; no lint will catch them.

- **Material change in meaning.** A one-word swap ("consider" for "understand") or a reversed
  clause order survives every string match, because the words really are on the page. This is
  also the legal test for fabricated quotation, so it is the residual risk that matters.
- **Splices.** Two real sentences from different parts of a talk, fused with an ellipsis that
  implies mere elision.
- **Speaker identity** in a panel, podcast or multi-author post.
- **Print pages.** Nothing can confirm words sit on a page, so `book` reaches `verbatim` only
  on a human's say-so.

## Checking a pointer resolves

The lint checks a pointer's *shape*. Confirming the words are actually there means fetching the
source, normalising both sides (strip punctuation, case, accents; collapse whitespace) and
substring-matching. `scripts/verify-pointers.py` is this table's implementation: every row below
is a route or a normalisation rule in it, with a test pinning that row. Change one and change the
other.

A non-match is not yet a defect. Every one of these has produced a false "fabricated" verdict,
so rule them out before accusing the corpus:

| Symptom | Cause and route |
| --- | --- |
| Every contraction fails | HTML entities. Unescape *after* stripping tags, or `don&#x27;t` normalises to `don x27 t` |
| A quote with `_emphasis_` never matches | Markdown emphasis. `_` is a word character, so it survives normalisation; strip `_` and `*` |
| An HTML page loses a paragraph around a `<` in its own prose | Unescaped `<` in text - `<1%`, `count<threshold`. A tag pattern that accepts any `<` runs to the document's next `>` and deletes everything between. Anchor it to a tag-name start character (`</?[A-Za-z!?]`); caption word timings legitimately open with a digit, so their stripper stays permissive |
| A raw `.md` file loses whole paragraphs | Tag-stripping non-HTML. A stray `<` and a later `>` swallow everything between; only strip tags from real HTML |
| A video quote is absent from the captions | It may be cited as the video *description*: `yt-dlp --skip-download --print description`. Captions need `--write-auto-subs --write-subs --sub-langs 'en.*'`, and carry no punctuation, so a 10-12 consecutive-word window is the confirmation |
| A caption quote misses by one repeated word | Speech disfluency, which auto-captions transcribe and no written quotation reproduces ("they're they're"). On caption routes only, collapse a word equal to its predecessor before matching. Adjacent-only, so it can shorten a run but never fuse two parts of a talk into a splice; a doubled word in written prose stays a real difference |
| A GitHub issue/PR comment is missing | The page is React-rendered. Read `repos/<owner>/<repo>/issues/comments/<id>` via `gh api`; a `/blob/` link needs `raw.githubusercontent.com` |
| A Reddit comment 404s or returns an interstitial | Reddit blocks CLI fetches and Firecrawl refuses the domain. Use `arctic-shift.photon-reddit.com/api/comments/ids?ids=<comment_id>` |
| An x.com post cannot be fetched | The site blocks CLI fetches and Firecrawl refuses it, but posts are **public with no auth**: `api.fxtwitter.com/<handle>/status/<id>`, falling back to `cdn.syndication.twimg.com/tweet-result?id=<id>&token=a`. No browser and no logged-in session are needed, and neither should be used - a cookie is a full credential and non-browser API calls get accounts banned. Both return the author `handle`: check it names the persona, because a reply or quote-post is someone else's words. (`~/git/kb`'s `skills/kb/scripts/get_tweet.py` implements both, where that vault is present) |
| A Wayback `id_` capture is mojibake | Compressed response. The `id_` replay serves the bytes as captured *with* the original `Content-Encoding: gzip`, whatever the request asked for, so a fetch without `curl --compressed` decodes to U+FFFD and matches nothing. Ask for it - and treat a body that is mostly replacement characters as a SKIP, so the next encoding gap reads as "never tested" rather than as an accusation |
| A page returns something non-empty but wrong | Bot-block or rate-limit page. HN throttles bursts; cxl.com, medium.com, newfangled.com and frontlines.io serve 403/429. Firecrawl gets through most of them |
| A slide quote matches nothing | SlideShare exposes slide text as image alt-text; scrape the deck page. Otherwise slide text is unconfirmable, like print |
| An archive.org link yields no text | `/details/` is an item page, not the book. Library scans are often lending-restricted: text 401s and search-inside is closed |

Two habits that prevent the rest: test the **full** URL rather than a truncated display form,
and treat "the fetch failed" and "the words are absent" as different findings. Only the second
is evidence; the first is a technical problem to route around.

## Five fabrication signatures

Every defect found in this corpus matched one of these. Check a suspicious quote against them:

1. **Jargon-authentic aphorism** - invented from the person's own vocabulary, so it passes
   every sniff test precisely because the vocabulary is real.
2. **Noun-swapped self-echo** - their famous line with two nouns changed.
3. **Too-balanced antithesis** - perfect tricolons are written prose, not transcribed speech.
4. **Recap-blog capture** - a summariser's own compression, lifted as the subject's words.
5. **Adjacent-colleague capture** - a co-founder's or co-author's line handed to the more
   famous name. The most common one by far.

## Misattributed quotes are kept, not deleted

Record what a person is *wrongly* credited with in a `## Misattributed` section, with who
actually said it. Deleting one only invites the next author who meets it elsewhere to add it
back, and knowing what someone did not say sharpens the persona as much as knowing what they
did.
