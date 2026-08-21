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
