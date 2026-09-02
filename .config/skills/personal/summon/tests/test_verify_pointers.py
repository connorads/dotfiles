"""Tests for scripts/verify-pointers.py.

Two layers. The unit tests pin the pure core - routing, extraction, matching -
one test per row of the symptom->cause table in ``references/attribution.md``,
because every one of those rows was first met as a false "fabricated quote"
verdict. The CLI tests pin the contract from outside, in the style of
``test_check_quotes.py``.

Offline and fast by construction: the whole suite runs on every summon commit,
so nothing here touches the network. ``tests/fixtures/pointers`` holds a small
hand-written body per bug class, indexed by ``manifest.json``.

Run: uv run --with pytest -- pytest tests/ -q  (from the skill root)
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
SCRIPT = SCRIPTS / "verify-pointers.py"
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "pointers"

# The script's own directory must be importable before it is loaded: it does
# `import quotelib`, which resolves off sys.path[0] when run as a script but not
# when loaded through importlib.
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    """Import a dash-named script as a module.

    ``verify-pointers`` is not a legal identifier, so the sibling-import pattern
    from ``.config/vox/test_merge.py`` needs importlib here. The module has to be
    registered in ``sys.modules`` before it executes: ``@dataclass`` looks its own
    class's module up there, and finds nothing if it is absent.
    """
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec
    assert spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


vp = _load("verify_pointers", SCRIPT)


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# --------------------------------------------------------------------------
# Normalisation
# --------------------------------------------------------------------------


def test_emphasis_is_stripped_on_top_of_normalise() -> None:
    # `_` is a \w character, so it survives normalise and `_enforces_` never
    # matches the page's `enforces`.
    assert vp.key("the grammar _enforces_ the shape") == "the grammar enforces the shape"


def test_normalise_itself_still_keeps_underscores() -> None:
    # The gate's inline-twin matching depends on this fold; moving the strip
    # inside normalise would silently shift check-quotes' baseline.
    from quotelib import normalise

    assert "_" in normalise("the grammar _enforces_ the shape")


def test_entities_are_unescaped_after_tags_are_stripped() -> None:
    # Unescaping first leaves `don&#x27;t` to normalise as `don x27 t`, and every
    # contraction in the corpus fails at once.
    text = vp.extract("html", fixture("entity-contractions.html"))
    assert "don't know what we don't know" in text


def test_escaped_markup_in_a_page_survives_tag_stripping() -> None:
    # The same ordering rule from the other side: an escaped `&lt;p&gt;` in the
    # page's own prose must not become a tag the stripper then eats.
    text = vp.extract("html", fixture("entity-contractions.html"))
    assert "<p> tag in this sentence is escaped" in text


# --------------------------------------------------------------------------
# Routing
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "kind", "target"),
    [
        (
            "https://github.com/mrdoob/three.js/blob/dev/README.md",
            "github_raw",
            "https://raw.githubusercontent.com/mrdoob/three.js/dev/README.md",
        ),
        (
            "https://github.com/mrdoob/three.js/issues/36#issuecomment-575994",
            "github_comment",
            "https://api.github.com/repos/mrdoob/three.js/issues/comments/575994",
        ),
        (
            "https://web.archive.org/web/20150413032050/http://example.com/essay",
            "wayback_raw",
            "https://web.archive.org/web/20150413032050id_/http://example.com/essay",
        ),
        (
            "https://www.reddit.com/r/programming/comments/abc123/some_title/def4567/",
            "reddit_comment",
            "https://arctic-shift.photon-reddit.com/api/comments/ids?ids=def4567",
        ),
        (
            "https://x.com/photomatt/status/1234567890",
            "x_post",
            "https://api.fxtwitter.com/photomatt/status/1234567890",
        ),
        (
            "https://news.ycombinator.com/item?id=3516591",
            "hn_item",
            "https://hacker-news.firebaseio.com/v0/item/3516591.json",
        ),
        (
            "https://arxiv.org/abs/1509.05393",
            "pdf",
            "https://arxiv.org/pdf/1509.05393",
        ),
        (
            "https://www.localfirst.fm/13",
            "html",
            "https://www.localfirst.fm/13/transcript",
        ),
        (
            "https://leanpub.com/example_storming",
            "pdf",
            "https://s3.amazonaws.com/samples.leanpub.com/example_storming-sample.pdf",
        ),
    ],
)
def test_url_rewrites(url: str, kind: str, target: str) -> None:
    plan = vp.route(url)
    assert (plan.kind, plan.url) == (kind, target)


def test_a_raw_markdown_url_is_never_treated_as_html() -> None:
    assert (
        vp.route("https://example.com/notes/raw-markdown-angle-brackets.md").kind == "raw_markdown"
    )


@pytest.mark.parametrize(
    "attribution",
    [
        "-- attributed | Agentifying your product, slide at 18:05 | https://youtu.be/abc",
        "-- verbatim | slides: Optimized for what, slide 31 of 152 | https://example.com/x",
        "-- attributed | Talk title, on the slide, 2019 | https://youtu.be/abc",
    ],
)
def test_a_slide_locus_is_recognised(attribution: str) -> None:
    assert vp.names_a_slide(attribution)


def test_a_slideshow_url_alone_is_not_a_slide_locus() -> None:
    # The locus is what the author wrote, not what the URL happens to contain.
    assert not vp.names_a_slide(
        "-- verbatim | talk: On velocity, 12:04 | https://www.slideshare.net/slideshow/x/1"
    )


def test_a_leanpub_sample_is_marked_partial() -> None:
    # The store page is a blurb; the only fetchable prose is a chapter or two,
    # so a miss there proves nothing about the book.
    assert vp.route("https://leanpub.com/example_storming").partial


def test_an_ordinary_route_is_not_partial() -> None:
    assert not vp.route("https://example.com/essay").partial


def test_an_archive_item_page_is_not_full_text() -> None:
    plan = vp.route("https://archive.org/details/somebook")
    assert plan.kind == "not_full_text"
    assert "item page" in plan.reason


def test_youtube_falls_back_from_captions_to_the_description() -> None:
    plan = vp.route("https://www.youtube.com/watch?v=5ZjhNTM8XU8")
    assert plan.kind == "youtube_captions"
    assert plan.alternates == ("youtube_description",)


def test_a_text_fragment_is_dropped_from_the_fetch_target() -> None:
    # `#:~:text=` is a scroll target no fetch sends, and keeping it would make
    # fifteen quotes citing one essay fetch that essay fifteen times.
    plan = vp.route("https://example.com/essay#:~:text=some%20words")
    assert plan.url == "https://example.com/essay"


def test_a_trailing_sentence_comma_is_not_part_of_the_url() -> None:
    assert vp.route("https://example.com/essay,").url == "https://example.com/essay"


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def test_raw_markdown_keeps_the_paragraph_between_two_angle_brackets() -> None:
    body = fixture("raw-markdown-angle-brackets.md")
    assert "a pointer is only evidence" in vp.extract("raw_markdown", body)


def test_tag_stripping_that_same_body_would_have_lost_it() -> None:
    # The reason the route exists, asserted rather than described: a stray `<`
    # and a later `>` swallow everything between them.
    body = fixture("raw-markdown-angle-brackets.md")
    assert "a pointer is only evidence" not in vp.strip_tags(body)


def test_a_bare_angle_bracket_in_prose_does_not_swallow_the_paragraph() -> None:
    # `<1%` in a performance post opened a span the stripper ran to the document's
    # next `>`, deleting 1,654 characters of brendangregg.com including the quote.
    text = vp.extract("html", fixture("bare-angle-bracket-in-prose.html"))
    assert "every benchmark is wrong until you can name the thing it is not measuring" in text


def test_real_tags_are_still_stripped_around_it() -> None:
    # The narrowed pattern must still eat doctypes, comments and ordinary tags.
    text = vp.extract("html", fixture("bare-angle-bracket-in-prose.html"))
    assert "doctype" not in text.lower()
    assert "still gets stripped" not in text
    assert "<p>" not in text


def test_caption_word_timings_are_still_stripped() -> None:
    # VTT timings genuinely open with a digit, so the caption stripper stays
    # permissive where the HTML one no longer is.
    assert vp.extract(
        "youtube_captions", "WEBVTT\n\n00:01.000 --> 00:02.000\nwe<00:01.500><c> ship</c>\n"
    ) == ("we ship")


def test_every_english_caption_track_reaches_the_haystack() -> None:
    # `--sub-langs en.*` also matches a manual track that is not a transcript -
    # Every Frame a Painting publishes one naming the films on screen - and byte
    # order put that ahead of the narration, so a 45-word quote windowed at 1.
    text = vp.extract("youtube_captions", fixture("vtt-two-tracks.vtt"))
    assert "Police Story 4" in text
    assert "in his style action is comedy" in text


def test_a_run_of_words_cannot_span_two_caption_tracks() -> None:
    # Joining the tracks into one haystack would otherwise let the end of one
    # and the start of the next read as contiguous speech - a splice across
    # artefacts, which is the one thing a match must never manufacture.
    text = vp.extract("youtube_captions", fixture("vtt-two-tracks.vtt"))
    assert not vp.match("Project A 1983 in his style action is comedy", text).exact


def test_rolling_captions_are_de_duplicated() -> None:
    text = vp.extract("youtube_captions", fixture("vtt-rolling-captions.vtt"))
    assert text.count("the fastest way to lose a") == 1
    assert "is to optimise for the wrong thing and call it velocity" in text


def test_slide_text_is_read_from_image_alt_attributes() -> None:
    text = vp.extract("slideshare", fixture("slideshare-alt-text.html"))
    assert "Mobile first forces you to focus on the content that matters most" in text


def test_a_github_comment_body_is_read_out_of_the_api_payload() -> None:
    text = vp.extract("github_comment", fixture("github-comment.json"))
    assert text.startswith("I don't think moving the whole library to Arrays")


def test_an_x_post_carries_its_author_handle() -> None:
    # A reply or quote-post under the same URL is someone else's words, so the
    # handle has to travel with the text.
    payload = json.dumps({"tweet": {"text": "Ship it.", "author": {"screen_name": "photomatt"}}})
    assert vp.extract("x_post", payload) == "@photomatt Ship it."


def test_an_hn_comment_carries_its_author_handle() -> None:
    # The reason this route exists at all: an `item?id=` page is the whole
    # thread, so a match there could confirm a stranger's reply as the
    # persona's words. The API returns one item, and the handle travels with it.
    text = vp.extract("hn_item", fixture("hn-item.json"))
    assert text.startswith("@garybernhardt ")


def test_an_hn_comment_body_is_unescaped_after_its_tags_are_stripped() -> None:
    # HN's `text` is real HTML with escaped entities inside it, so it needs the
    # same ordering any page does - otherwise every contraction in it fails.
    text = vp.extract("hn_item", fixture("hn-item.json"))
    assert "because they're so repeatable" in text
    assert "<p>" not in text


def test_a_json_escaped_transcript_inside_a_script_blob_is_read() -> None:
    body = (
        "<!doctype html><html><body><p>Loading</p>"
        '<script id="__NEXT_DATA__">{"transcript":"we don\\u0027t ship on a schedule"}</script>'
        "</body></html>"
    )
    assert "we don't ship on a schedule" in vp.extract("html", body)


def test_plain_javascript_is_not_mined_into_the_haystack() -> None:
    body = "<!doctype html><html><body><p>Real text</p><script>var x = 1;</script></body></html>"
    assert "var x" not in vp.extract("html", body)


def test_a_rate_limit_page_is_recognised_as_a_block() -> None:
    assert vp.looks_blocked(fixture("rate-limited-page.html"))


def test_a_client_challenge_wall_is_recognised_as_a_block() -> None:
    # SlideShare's wall serves HTTP 200 and says neither "blocked" nor "rate
    # limit", so both slideshare quotes in alberto-brandolini.md were scored
    # FAIL against a page that carried no slide text at all.
    assert vp.looks_blocked(fixture("client-challenge-wall.html"))


def test_an_ordinary_page_is_not_a_block() -> None:
    assert not vp.looks_blocked(fixture("entity-contractions.html"))


def test_an_article_that_discusses_rate_limiting_is_not_a_rate_limit_page() -> None:
    # The ninth bug of the same class, met live: scanning for the signatures
    # alone read "request counters per IP address (for rate limiting purposes)"
    # as a block, and four sourced quotes in martin-kleppmann.md vanished into
    # SKIPs behind an article that had fetched perfectly.
    assert not vp.looks_blocked(fixture("long-article-mentioning-rate-limits.html"))


def test_a_block_page_is_recognised_by_its_title_however_long_it_is() -> None:
    body = (
        "<!doctype html><html><head><title>429 Too Many Requests</title></head>"
        "<body>"
        + "<p>Boilerplate that pads this page well past the length cut.</p>" * 60
        + "</body></html>"
    )
    assert vp.looks_blocked(body)


# --------------------------------------------------------------------------
# Matching
# --------------------------------------------------------------------------


def test_an_exact_match_reports_as_exact() -> None:
    result = vp.match("Design is how it works.", "He said design is how it works, plainly.")
    assert result.exact
    assert result.window == 5


def test_a_near_miss_reports_its_longest_window() -> None:
    result = vp.match("one two three four five", "one two three then something else")
    assert not result.exact
    assert result.window == 3


def test_no_shared_words_is_a_zero_window() -> None:
    assert vp.match("nothing here at all", "entirely different prose").window == 0


def test_a_caption_window_confirms_a_quote_that_cannot_match_exactly() -> None:
    haystack = vp.extract("youtube_captions", fixture("vtt-rolling-captions.vtt"))
    quote = (
        "The fastest way to lose a team is to optimise for the wrong thing and call it velocity."
    )
    verdict = vp.classify(quote, "youtube_captions", fixture("vtt-rolling-captions.vtt"), None)
    assert not vp.match(quote, haystack).exact
    assert verdict.status == "PASS"
    assert verdict.window >= vp.MIN_WINDOW


def test_a_stuttered_caption_still_matches_a_tidied_quote() -> None:
    # Auto-captions transcribe speech, so they carry stutters no written
    # quotation reproduces. A nine-word quote has no room for the window rule to
    # absorb one, so without the caption fold this is a FAIL at 7/9.
    body = fixture("vtt-disfluency.vtt")
    quote = "We should stop treating the schema as an afterthought."
    assert not vp.match(quote, vp.extract("youtube_captions", body)).exact
    verdict = vp.classify(quote, "youtube_captions", body, None)
    assert verdict.status == "PASS"
    assert verdict.reason == "exact, 9 words"


def test_the_stutter_fold_only_drops_an_immediately_repeated_word() -> None:
    # The live case: `they're they're` normalises to an adjacent duplicate.
    assert vp.caption_key("they're they're not fundamentally") == vp.key(
        "they're not fundamentally"
    )
    # Adjacent-only is what makes it safe. A non-adjacent repeat survives, so
    # the fold can shorten a run but never fuse two parts of a talk into one.
    assert vp.caption_key("we ship we ship") == "we ship we ship"


def test_a_doubled_word_in_written_prose_stays_a_difference() -> None:
    # Scoping, pinned. Essays have no disfluency, so the same fold on the html
    # route would be tolerating a real difference.
    verdict = vp.classify(
        "We should stop treating the schema as an afterthought.",
        "html",
        "<p>we should should stop treating the schema as an afterthought</p>",
        None,
    )
    assert verdict.status == "FAIL"


def test_a_quote_that_marks_its_elisions_matches_each_segment() -> None:
    # `normalise` folds `[...]` away as punctuation, so the segments either side
    # were demanded contiguous and a quote honest about its own elision could
    # never match.
    haystack = vp.extract("html", fixture("elided-quote.html"))
    quote = (
        "Static is globally fast. [...] Static is consistently fast. [...] Static is always online."
    )
    assert vp.match(quote, haystack).exact


def test_a_bare_ellipsis_is_an_elision_marker_too() -> None:
    quote = "Convincing people that these aren't a sentient AI... can come later."
    page = (
        "Convincing people that these aren't a sentient AI out of a science fiction "
        "story can come later. Once people understand their flaws this is easier."
    )
    assert vp.match(quote, page).exact


def test_elided_segments_must_appear_in_order() -> None:
    # The ordering rule is what stops an elision marker becoming a licence to
    # splice: quoting a source backwards is not quoting it.
    page = "alpha one two three and then beta four five six"
    assert not vp.match("four five six ... one two three", page).exact


def test_elided_segments_may_not_claim_the_same_words_twice() -> None:
    page = "the only sentence available here"
    assert not vp.match("the only sentence ... the only sentence", page).exact


def test_a_failed_elision_falls_back_rather_than_reporting_zero() -> None:
    # The rule is additive. A quote whose segments do not line up must be judged
    # exactly as it was before, not dropped to a 0-word window.
    page = "one two three four five six seven eight nine ten eleven twelve"
    result = vp.match("one two three four five six seven eight nine ten ... absent words", page)
    assert not result.exact
    assert result.window == 10


def test_a_decimal_is_not_an_elision_marker() -> None:
    assert vp.split_elisions("a ratio of 1...2 and a price of 3.50") == [
        "a ratio of 1...2 and a price of 3.50"
    ]


def test_a_short_quote_needs_an_exact_match() -> None:
    # Below the window threshold a partial run is not evidence of anything.
    verdict = vp.classify("one two three four five", "html", "<p>one two three only</p>", None)
    assert verdict.status == "FAIL"


# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------


def test_a_block_page_is_a_skip_not_a_fail() -> None:
    verdict = vp.classify("anything at all", "html", fixture("rate-limited-page.html"), None)
    assert verdict.status == "SKIP"


def test_an_undecoded_body_is_a_skip_not_a_fail() -> None:
    # A Wayback `id_` replay serves the capture's original `Content-Encoding`,
    # so an un-decompressed body decodes to mojibake that matches nothing. That
    # is a fetch which tested nothing, not a corpus defect.
    verdict = vp.classify(
        "Since the visualisation explained why the CPUs were busy",
        "wayback_raw",
        fixture("gzip-undecoded-capture.txt"),
        None,
    )
    assert verdict.status == "SKIP"
    assert "not text" in verdict.reason


def test_an_ordinary_page_with_one_mangled_character_is_not_undecoded() -> None:
    # Every real page in the sweep sat at or below 0.004% replacement characters.
    assert not vp.looks_undecoded("a page of perfectly ordinary prose with one � in it")


def test_the_fetcher_asks_for_and_decodes_compressed_bodies() -> None:
    # The flag is unreachable from an offline fixture, so it is pinned on the argv.
    assert "--compressed" in vp.CURL_BASE


def test_a_fetch_error_is_a_skip_carrying_its_reason() -> None:
    verdict = vp.classify("anything", "html", None, "yt-dlp is not installed")
    assert verdict.status == "SKIP"
    assert "yt-dlp" in verdict.reason


def test_an_empty_body_is_a_skip() -> None:
    assert vp.classify("anything", "html", "   ", None).status == "SKIP"


# --------------------------------------------------------------------------
# CLI contract
# --------------------------------------------------------------------------

CASES = {
    "entity-contractions": (
        "> \"We don't know what we don't know about production.\"\n"
        "-- verbatim | blog: On production, example.com, 2020-01-01"
        " | https://example.com/entity-contractions\n"
    ),
    "hn-item": (
        '> "I practice my talks a lot, and I can get the timing down perfectly because'
        " it's always the same.\"\n"
        "-- verbatim | Hacker News comment, 2012-02-03"
        " | https://news.ycombinator.com/item?id=3516591\n"
    ),
    "leanpub-sample": (
        '> "I still don\'t know how to end this book."\n'
        "-- verbatim | book: Introducing Example Storming, Preface"
        " | https://leanpub.com/example_storming\n"
    ),
    "localfirst-transcript": (
        '> "The whole philosophy is redistribute the power away from the urban elite and'
        ' into like the rural masses."\n'
        "-- verbatim | podcast: localfirst.fm #13, 2024, 10:30"
        " | https://www.localfirst.fm/13\n"
    ),
    "markdown-emphasis": (
        '> "the grammar _enforces_ the shape of that claim"\n'
        "-- verbatim | blog: On claims, example.com, 2021-02-02"
        " | https://example.com/markdown-emphasis\n"
    ),
    "raw-markdown": (
        '> "a pointer is only evidence when the fetch and the parse are both honest"\n'
        "-- verbatim | notes: Comparison, example.com, 2022-03-03"
        " | https://example.com/notes/raw-markdown-angle-brackets.md\n"
    ),
    "vtt-captions": (
        '> "The fastest way to lose a team is to optimise for the wrong thing and call it'
        ' velocity."\n'
        "-- verbatim | talk: On velocity, Example Conf, 2019, 12:04"
        " | https://www.youtube.com/watch?v=vttfixture\n"
    ),
    "bare-angle-bracket": (
        '> "every benchmark is wrong until you can name the thing it is not measuring"\n'
        "-- verbatim | blog: On measuring things, example.com, 2024-03-17"
        " | https://example.com/measuring-things\n"
    ),
    "vtt-two-tracks": (
        '> "In his style, action IS comedy. And that is what makes him worth watching."\n'
        "-- verbatim | video: On Jackie Chan, YouTube, 2015, 00:20"
        " | https://www.youtube.com/watch?v=twotracks\n"
    ),
    "vtt-disfluency": (
        '> "We should stop treating the schema as an afterthought."\n'
        "-- verbatim | talk: On schemas, Example Conf, 2020, 00:28"
        " | https://www.youtube.com/watch?v=disfluency\n"
    ),
    "elided-quote": (
        '> "Static is globally fast. [...] Static is consistently fast. [...] Static is'
        ' always online."\n'
        "-- verbatim | blog: Three things about static, example.com, 2020-01-01"
        " | https://example.com/three-things-about-static\n"
    ),
    "github-blob": (
        '> "Every allocation matters when you are creating thousands of objects per frame."\n'
        "-- verbatim | mrdoob/three.js, 2017-10-18"
        " | https://github.com/mrdoob/three.js/blob/dev/README.md\n"
    ),
    "github-comment": (
        '> "I don\'t think moving the whole library to Arrays is a good idea."\n'
        "-- verbatim | mrdoob/three.js#36, 30 November 2010"
        " | https://github.com/mrdoob/three.js/issues/36#issuecomment-575994\n"
    ),
    "wayback": (
        '> "Design is not just what it looks like and feels like. Design is how it works."\n'
        "-- verbatim | article: NYT Magazine, 2003-11-30"
        " | https://web.archive.org/web/20150413032050/http://example.com/essay\n"
    ),
    "slideshare": (
        '> "Mobile first forces you to focus on the content that matters most"\n'
        "-- verbatim | slides: Mobile First, 2011"
        " | https://www.slideshare.net/slideshow/mobile-first/12345\n"
    ),
    "rate-limit-prose": (
        '> "If you are depending on your lock for correctness, most of the time is not enough."\n'
        "-- verbatim | blog: How to do distributed locking, example.com, 2016-02-08"
        " | https://example.com/distributed-locking\n"
    ),
    "truncated-url": (
        '> "Test the one that resolves, not the one that fits the column."\n'
        "-- verbatim | blog: On URLs, example.com, 2023-04-04"
        " | https://example.com/a/very/long/path/to/an/essay-on-verification"
        "#:~:text=display%20form\n"
    ),
}


def write_skill(root: Path, dossiers: dict[str, str]) -> None:
    (root / "references").mkdir(parents=True, exist_ok=True)
    for name, body in dossiers.items():
        text = f"# Persona\n\n## Aliases\n\n- {Path(name).stem}\n\n## Sourced Quotes\n\n{body}"
        (root / "references" / name).write_text(text, encoding="utf-8")


def run(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--root",
            str(root),
            "--offline",
            "--cache",
            str(FIXTURES),
            *args,
        ],
        capture_output=True,
        text=True,
        check=False,
    )


@pytest.mark.parametrize("case", sorted(CASES))
def test_each_bug_class_confirms_its_quote(tmp_path: Path, case: str) -> None:
    write_skill(tmp_path, {f"{case}.md": CASES[case]})
    result = run(tmp_path, "--all")
    assert result.returncode == 0, result.stdout
    assert "1 pass, 0 fail, 0 skip" in result.stdout, result.stdout


def test_an_absent_quote_fails(tmp_path: Path) -> None:
    body = (
        '> "A sentence that is nowhere on the fetched page, however plausible it sounds."\n'
        "-- verbatim | blog: On claims, example.com, 2021-02-02"
        " | https://example.com/markdown-emphasis\n"
    )
    write_skill(tmp_path, {"absent.md": body})
    result = run(tmp_path, "--all")
    assert "FAIL" in result.stdout
    assert "0 pass, 1 fail, 0 skip" in result.stdout


def test_a_fail_still_exits_zero_by_default(tmp_path: Path) -> None:
    # A FAIL is 'look closer', not a verdict; exiting non-zero would teach the
    # next author to read it as one.
    write_skill(tmp_path, {"absent.md": CASES["markdown-emphasis"].replace("grammar", "charter")})
    assert run(tmp_path, "--all").returncode == 0


def test_strict_exits_one_on_a_fail(tmp_path: Path) -> None:
    write_skill(tmp_path, {"absent.md": CASES["markdown-emphasis"].replace("grammar", "charter")})
    assert run(tmp_path, "--all", "--strict").returncode == 1


def test_a_rate_limited_page_skips_rather_than_failing(tmp_path: Path) -> None:
    body = (
        '> "A line the rate limit page could never carry, whatever it says."\n'
        "-- verbatim | blog: Throttled, example.com, 2020-01-01"
        " | https://example.com/rate-limited\n"
    )
    write_skill(tmp_path, {"blocked.md": body})
    result = run(tmp_path, "--all")
    assert "SKIP" in result.stdout
    assert "0 pass, 0 fail, 1 skip" in result.stdout


def test_an_undecoded_capture_skips_rather_than_failing(tmp_path: Path) -> None:
    # End to end: a Wayback replay served as gzip must never reach the matcher.
    body = (
        '> "Since the visualisation explained why the CPUs were busy."\n'
        "-- verbatim | article: ACM Queue, 2016-03-01"
        " | https://web.archive.org/web/20220310181811/https://example.com/queue-article\n"
    )
    write_skill(tmp_path, {"gzip.md": body})
    result = run(tmp_path, "--all")
    assert "0 pass, 0 fail, 1 skip" in result.stdout
    assert "bytes that are not text" in result.stdout


def test_a_client_challenge_wall_skips_rather_than_failing(tmp_path: Path) -> None:
    body = (
        '> "A line the deck carries and the challenge page never could."\n'
        "-- verbatim | slides: Walled deck, SlideShare, 2016-11-20"
        " | https://www.slideshare.net/slideshow/walled-deck/54321\n"
    )
    write_skill(tmp_path, {"walled.md": body})
    result = run(tmp_path, "--all")
    assert "0 pass, 0 fail, 1 skip" in result.stdout


def test_a_slide_quote_on_a_video_pointer_skips_rather_than_failing(tmp_path: Path) -> None:
    # Pinned at the locus layer: no fetch happens, so this passes with an empty
    # cache. Slide text is rendered into pixels, which no caption track carries.
    body = (
        '> "Be as ambitious as you can be, but no more."\n'
        "-- attributed | Agentifying your product, slide at 21:05"
        " | https://www.youtube.com/watch?v=neverfetched\n"
    )
    write_skill(tmp_path, {"slide.md": body})
    result = run(tmp_path, "--all")
    assert "0 pass, 0 fail, 1 skip" in result.stdout
    assert "cited to a slide" in result.stdout


def test_a_spoken_quote_on_the_same_video_pointer_is_still_verified(tmp_path: Path) -> None:
    # Scoping: only the slide locus opts out, not every quote from the talk.
    body = (
        '> "We should stop treating the schema as an afterthought."\n'
        "-- verbatim | talk: On schemas, Example Conf, 2020, 00:28"
        " | https://www.youtube.com/watch?v=disfluency\n"
    )
    write_skill(tmp_path, {"spoken.md": body})
    assert "1 pass, 0 fail, 0 skip" in run(tmp_path, "--all").stdout


def test_a_quote_beyond_a_book_sample_skips_rather_than_failing(tmp_path: Path) -> None:
    # Absent from part of an artefact is not absent from the artefact. Without
    # this, adding the sample route would turn every quote from later in a book
    # into a fresh accusation.
    body = (
        '> "A sentence from chapter nine, well past where the free sample stops."\n'
        "-- verbatim | book: Introducing Example Storming, ch. 9"
        " | https://leanpub.com/example_storming\n"
    )
    write_skill(tmp_path, {"beyond.md": body})
    result = run(tmp_path, "--all")
    assert "0 pass, 0 fail, 1 skip" in result.stdout
    assert "free sample" in result.stdout


def test_an_archive_item_page_skips_with_a_named_reason(tmp_path: Path) -> None:
    body = (
        '> "Words that live in a lending-restricted scan."\n'
        "-- verbatim | book: Some Title, 1st edn, p. 12"
        " | https://archive.org/details/some-book\n"
    )
    write_skill(tmp_path, {"scan.md": body})
    result = run(tmp_path, "--all")
    assert "SKIP" in result.stdout
    assert "item page" in result.stdout


def test_a_pointer_with_no_url_skips(tmp_path: Path) -> None:
    body = (
        '> "Words on a printed page, which nothing here can confirm."\n'
        "-- verbatim | book: Designing Data-Intensive Applications, 1st edn, pp. 161-162\n"
    )
    write_skill(tmp_path, {"book.md": body})
    result = run(tmp_path, "--all")
    assert "pointer names no URL" in result.stdout


def test_an_uncached_url_skips_when_offline(tmp_path: Path) -> None:
    body = (
        '> "A line behind a page this run may not fetch."\n'
        "-- verbatim | blog: Elsewhere, example.org, 2024-01-01"
        " | https://example.org/never-fetched\n"
    )
    write_skill(tmp_path, {"miss.md": body})
    result = run(tmp_path, "--all")
    assert "not in cache (--offline)" in result.stdout


def test_paraphrase_quotes_are_not_verified(tmp_path: Path) -> None:
    # Only `verbatim` and `attributed` claim a pointer; the rest make no claim
    # a fetch could test.
    write_skill(tmp_path, {"para.md": '> "A remembered position."\n-- paraphrase | (paraphrase)\n'})
    result = run(tmp_path, "--all")
    assert "0 pass, 0 fail, 0 skip" in result.stdout


def test_named_files_are_verified_without_all(tmp_path: Path) -> None:
    write_skill(tmp_path, {"one.md": CASES["github-comment"]})
    result = run(tmp_path, str(tmp_path / "references" / "one.md"))
    assert "1 pass, 0 fail, 0 skip" in result.stdout


def test_no_targets_is_not_an_error(tmp_path: Path) -> None:
    assert run(tmp_path, str(tmp_path / "README.md")).returncode == 0


def test_json_report_is_machine_readable(tmp_path: Path) -> None:
    write_skill(tmp_path, {"one.md": CASES["wayback"]})
    result = run(tmp_path, "--all", "--json")
    payload = json.loads(result.stdout)
    assert payload["summary"] == {"PASS": 1, "FAIL": 0, "SKIP": 0}
    assert payload["files"][0]["results"][0]["route"] == "wayback_raw"


def test_the_offline_run_writes_nothing_into_the_fixture_cache(tmp_path: Path) -> None:
    # A fixture dir is reviewed bytes; a verifier run must not add to it.
    before = sorted(p.name for p in FIXTURES.iterdir())
    write_skill(tmp_path, {"miss.md": CASES["github-blob"]})
    run(tmp_path, "--all")
    assert sorted(p.name for p in FIXTURES.iterdir()) == before
