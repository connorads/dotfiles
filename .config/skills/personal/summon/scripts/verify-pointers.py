#!/usr/bin/env python3
"""Confirm a dossier's pointers actually carry the words they are cited for.

``check-quotes.py`` checks a pointer's *shape*; nothing checked whether the words
are behind it. This does: fetch each pointer, extract text, normalise both sides,
substring-match. The symptom->cause table in ``references/attribution.md`` is this
script's specification - every row there is a route or a normalisation rule here,
and a test in ``tests/test_verify_pointers.py`` pins it.

**It is a report, not a gate.** A FAIL means *look closer*, not *the corpus is
wrong*: on the sweep that produced this tool, eight consecutive FAILs were bugs in
the checker rather than defects in the corpus. So the default exit status is 0, and
nothing in hk runs it. Only its offline tests run at commit time.

Missing optional tools (yt-dlp, gh, pdftotext) degrade their route to SKIP with a
named reason, never to a FAIL - a verifier that cannot fetch has found nothing.

Usage:
    verify-pointers.py FILE.md [...]        just these dossiers
    verify-pointers.py --all                every dossier
    verify-pointers.py --all --offline --cache tests/fixtures/pointers
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit

from quotelib import NEEDS_POINTER, URL, Quote, is_dossier, normalise, parse_quotes

# A caption track carries no punctuation, so an exact match is unavailable there
# and a consecutive-word window is the confirmation. Ten words of prose recurring
# in order is not coincidence; below that, only an exact match is evidence.
MIN_WINDOW = 10

# Routes carrying transcribed speech, which records disfluency. A video's
# *description* is written, so it is not one of these.
CAPTION_ROUTES = frozenset({"youtube_captions"})

FETCH_TIMEOUT = 30
# Honest-crawler convention: Mozilla-compatible so ordinary pages render, and
# named so a log line says who called. Blocks are SKIPped, never worked around.
USER_AGENT = "Mozilla/5.0 (compatible; summon-verify-pointers/1)"


# --------------------------------------------------------------------------
# Pure core
# --------------------------------------------------------------------------

UNDERSCORE = re.compile(r"_+")


def strip_emphasis(key: str) -> str:
    """Drop Markdown emphasis from a normalised comparison key.

    ``quotelib.normalise`` folds away every non-word character *except* ``_``,
    which is a ``\\w`` character - so a dossier's ``_enforces_`` stays
    ``_enforces_`` and never matches the page's ``enforces``.

    This is layered on top of ``normalise`` and must never be folded into it:
    ``normalise`` is also what pairs an inline quote with its line-level twin in
    ``check-quotes.py``, and changing that fold would silently move the gate's
    baseline. Here, only the verifier sees it.
    """
    return " ".join(UNDERSCORE.sub(" ", key).split())


def key(text: str) -> str:
    """The comparison key both sides of a match are folded to."""
    return strip_emphasis(normalise(text))


def collapse_stutter(folded: str) -> str:
    """Drop a word equal to its predecessor, in an already-folded key.

    Auto-captions transcribe speech, so they record the stutters no written
    quotation reproduces: a talk whose caption track says "we should kill rest
    apis because they're they're not fundamentally publish subscribe" is quoted
    with one ``they're``. An eleven-word quote leaves no room for the
    consecutive-word window to absorb a mid-sentence disruption, so it windows
    at 7 and fails while longer quotes carrying the same noise pass.

    Collapsing *adjacent* duplicates is structurally safe: it can only remove an
    immediately repeated token, so unlike a looser threshold it cannot fuse text
    from two parts of a talk into a splice - the failure mode
    ``references/attribution.md`` says a machine must never manufacture.

    Layered on top of ``key`` in the same spirit as ``strip_emphasis`` sitting
    on top of ``quotelib.normalise``, and scoped to caption routes: written
    prose has no disfluency, so a doubled word in an essay is a real difference.
    """
    words = folded.split()
    return " ".join(word for i, word in enumerate(words) if i == 0 or word != words[i - 1])


def caption_key(text: str) -> str:
    """The comparison key for a caption track: ``key``, minus stutters."""
    return collapse_stutter(key(text))


@dataclass(frozen=True)
class Route:
    """How to fetch a pointer and how to read what comes back.

    ``url`` is the *fetch target*, which may differ from the cited URL: a
    ``/blob/`` link has to become ``raw.githubusercontent.com``, a Wayback
    snapshot has to gain its ``id_`` suffix, and a ``#issuecomment-`` anchor has
    to become an API path, because each of those pages otherwise returns
    something that is not the text.
    """

    kind: str
    url: str
    reason: str = ""
    alternates: tuple[str, ...] = ()


GITHUB_BLOB = re.compile(r"^https?://github\.com/([^/]+)/([^/]+)/blob/(.+)$")
GITHUB_COMMENT = re.compile(
    r"^https?://github\.com/([^/]+)/([^/]+)/(?:issues|pull)/\d+.*#issuecomment-(\d+)"
)
WAYBACK = re.compile(r"^(https?://web\.archive\.org/web/)(\d{4,14})(/)(.*)$", re.IGNORECASE)
REDDIT_COMMENT = re.compile(r"^https?://(?:\w+\.)?reddit\.com/r/[^/]+/comments/\w+/[^/]*/(\w{5,})")
X_POST = re.compile(r"^https?://(?:www\.)?(?:x|twitter)\.com/([^/]+)/status/(\d+)")
ARXIV_ABS = re.compile(r"^https?://arxiv\.org/abs/(.+)$")

PLAIN_TEXT_SUFFIXES = (".md", ".markdown", ".txt", ".rst", ".vtt", ".srt")


def route(url: str) -> Route:
    """Pick a fetch target and an extraction strategy for a cited URL."""
    url = url.rstrip(".,;)")

    if match := GITHUB_COMMENT.match(url):
        owner, repo, comment = match.groups()
        # The issue page is React-rendered, so the comment body is not in the
        # HTML at all. The REST comment endpoint returns it as markdown.
        return Route(
            "github_comment",
            f"https://api.github.com/repos/{owner}/{repo}/issues/comments/{comment}",
        )

    # Past that one route, the fragment is a scroll target - `#:~:text=`, `#L42`
    # - that no fetch ever sends. Dropping it is also what stops fifteen quotes
    # citing one essay with fifteen different text fragments from fetching it
    # fifteen times.
    url = url.split("#", 1)[0]

    if match := GITHUB_BLOB.match(url):
        owner, repo, rest = match.groups()
        rest = rest.split("?", 1)[0]
        return Route("github_raw", f"https://raw.githubusercontent.com/{owner}/{repo}/{rest}")

    if match := WAYBACK.match(url):
        prefix, stamp, _, original = match.groups()
        # A bare snapshot URL serves the archive's own chrome wrapped round the
        # page. The `id_` suffix asks for the captured bytes instead.
        return Route("wayback_raw", f"{prefix}{stamp}id_/{original}")

    if match := REDDIT_COMMENT.match(url):
        # Reddit blocks CLI fetches outright; Arctic Shift mirrors the comment.
        comment_id = match.group(1)
        return Route(
            "reddit_comment",
            f"https://arctic-shift.photon-reddit.com/api/comments/ids?ids={comment_id}",
        )

    if match := X_POST.match(url):
        handle, post = match.groups()
        # Public with no auth. A cookie is a full credential and non-browser API
        # calls get accounts banned, so neither is used.
        return Route("x_post", f"https://api.fxtwitter.com/{handle}/status/{post}")

    host = urlsplit(url).netloc.lower()
    path = urlsplit(url).path.lower()

    if host.endswith(("youtube.com", "youtu.be")):
        # Two artefacts behind one URL, and the quote may be in either. Captions
        # first because most are; the description is the common near-miss.
        return Route("youtube_captions", url, alternates=("youtube_description",))

    if host == "archive.org" and path.startswith("/details/"):
        return Route(
            "not_full_text",
            url,
            reason="archive.org /details/ is an item page, not the text",
        )

    if host.endswith("reddit.com"):
        return Route(
            "not_full_text",
            url,
            reason="Reddit blocks CLI fetches and the URL names no comment id",
        )

    if match := ARXIV_ABS.match(url):
        # The abstract page carries the abstract only; sections are in the PDF.
        return Route("pdf", f"https://arxiv.org/pdf/{match.group(1)}")

    if path.endswith(".pdf"):
        return Route("pdf", url)

    if host.endswith("slideshare.net"):
        return Route("slideshare", url)

    if host == "raw.githubusercontent.com":
        return Route("github_raw", url)

    if path.endswith(PLAIN_TEXT_SUFFIXES) or host == "gist.githubusercontent.com":
        return Route("raw_markdown", url)

    return Route("html", url)


HTML_SNIFF = re.compile(r"(?is)<(?:!doctype\s+html|html|head|body|div|p|span|meta|a\s)\b")
# A tag opens with a name, a closing slash, `!` (doctype, comment) or `?` (PI).
# Requiring one of those is what stops a bare `<` in the page's own prose - a
# `<1%` in a performance post - from opening a span the stripper then runs to
# the next `>` anywhere later in the document. `VTT_INLINE_TAG` stays permissive
# because a caption's word timings genuinely do open with a digit.
TAG = re.compile(r"(?s)</?[A-Za-z!?][^>]*>")
DROPPED_ELEMENT = re.compile(r"(?is)<(script|style|noscript)\b[^>]*>.*?</\1>")
SCRIPT_BODY = re.compile(r"(?is)<script\b[^>]*>(.*?)</script>")
ALT_TEXT = re.compile(r"""(?is)\balt\s*=\s*(["'])(.*?)\1""")
JSON_ESCAPE = re.compile(r'\\u([0-9a-fA-F]{4})|\\(["\\/nrtbf])')
VTT_INLINE_TAG = re.compile(r"(?s)<[^>]*>")
VTT_CUE = re.compile(r"-->")


def looks_like_html(body: str) -> bool:
    """Whether a body is real HTML, as against text that merely holds ``<``.

    Tag-stripping a raw ``.md`` file loses whole paragraphs: a stray ``<`` and a
    later ``>`` swallow everything between them.
    """
    return bool(HTML_SNIFF.search(body[:4000]))


def strip_tags(body: str) -> str:
    """Visible text from HTML: drop tags, *then* unescape.

    Order matters. Unescaping first turns an escaped ``&lt;p&gt;`` in the page's
    own prose into a tag the stripper then eats, and - the symptom that reads as
    mass fabrication - leaves ``don&#x27;t`` to normalise as ``don x27 t``, so
    every contraction in the corpus fails at once.

    An *unescaped* ``<`` in prose is the same wound from the other side, and it
    is silent: ``TAG`` is anchored to a tag-name start character precisely so
    ``<1%`` cannot swallow the 1,654 characters up to the document's next ``>``.
    """
    body = DROPPED_ELEMENT.sub(" ", body)
    return " ".join(html.unescape(TAG.sub(" ", body)).split())


def unescape_json_payload(blob: str) -> str:
    r"""Decode JSON string escapes in an embedded payload.

    Transcripts and article bodies ride inside ``__NEXT_DATA__``-style script
    blobs, where the words are real but every apostrophe is ``'``.
    """

    def one(match: re.Match[str]) -> str:
        if match.group(1):
            return chr(int(match.group(1), 16))
        return {"n": "\n", "r": "\n", "t": " ", "b": " ", "f": " "}.get(
            match.group(2), match.group(2)
        )

    return JSON_ESCAPE.sub(one, blob)


def _script_payloads(body: str) -> list[str]:
    """Text mined from script blobs that carry JSON-escaped strings.

    Restricted to blobs showing JSON escapes: plain JS source has no business in
    the haystack, and a wider net risks confirming a quote against page
    furniture.
    """
    found = []
    for blob in SCRIPT_BODY.findall(body):
        if "\\u" not in blob and '\\"' not in blob:
            continue
        text = unescape_json_payload(blob)
        found.append(" ".join(TAG.sub(" ", text).split()))
    return found


def dedupe_rolling(lines: list[str]) -> str:
    """Join caption cues, collapsing the overlap rolling captions repeat.

    An auto-caption track re-sends the previous cue's tail at the head of the
    next one, so a naive join reads "we spent forty we spent forty years". The
    overlap is dropped, which can also eat a genuine repetition - that shortens
    the haystack, so it can only cost a PASS, never invent one.
    """
    words: list[str] = []
    for line in lines:
        new = line.split()
        if not new:
            continue
        limit = min(len(words), len(new))
        overlap = next((k for k in range(limit, 0, -1) if words[-k:] == new[:k]), 0)
        words.extend(new[overlap:])
    return " ".join(words)


def extract_vtt(body: str) -> str:
    """Spoken text from a WebVTT caption track."""
    lines = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line or VTT_CUE.search(line) or line.isdigit():
            continue
        if line.startswith(("WEBVTT", "NOTE", "STYLE", "REGION", "Kind:", "Language:")):
            continue
        line = html.unescape(VTT_INLINE_TAG.sub("", line)).strip()
        if line:
            lines.append(line)
    return dedupe_rolling(lines)


def extract(kind: str, body: str) -> str:
    """Plain text from a fetched body, by route."""
    if kind in ("github_raw", "raw_markdown"):
        # Never tag-strip: this is text that merely contains angle brackets.
        return " ".join(body.split())

    if kind == "youtube_captions":
        return extract_vtt(body)

    if kind == "youtube_description":
        return " ".join(body.split())

    if kind == "github_comment":
        return " ".join(_json_field(body, "body").split())

    if kind == "x_post":
        payload = _load_json(body) or {}
        tweet = payload.get("tweet") or {}
        author = (tweet.get("author") or {}).get("screen_name", "")
        text = tweet.get("text", "")
        # The handle travels with the text: a reply or quote-post under the same
        # URL is someone else's words.
        return " ".join(f"@{author} {text}".split())

    if kind == "reddit_comment":
        payload = _load_json(body) or {}
        items = payload.get("data") or []
        return " ".join(" ".join(item.get("body", "") for item in items).split())

    if kind == "slideshare":
        # SlideShare exposes slide text as image alt-text, so the deck's words
        # are in attributes rather than in any element's body.
        alts = [html.unescape(m.group(2)) for m in ALT_TEXT.finditer(body)]
        return " ".join((" ".join(alts) + " " + strip_tags(body)).split())

    if kind == "pdf":
        return " ".join(body.split())

    # html and wayback_raw: a snapshot may be either HTML or the raw artefact.
    if not looks_like_html(body):
        return " ".join(body.split())
    return " ".join([strip_tags(body), *_script_payloads(body)]).strip()


def _load_json(body: str) -> dict | None:
    try:
        payload = json.loads(body)
    except (ValueError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def _json_field(body: str, field: str) -> str:
    payload = _load_json(body)
    return str(payload.get(field, "")) if payload else ""


BLOCK_SIGNATURES = (
    "rate limit",
    "too many requests",
    "429 too many",
    "just a moment",
    "enable javascript and cookies",
    "attention required! | cloudflare",
    "checking your browser",
    "access denied",
    "you have been blocked",
    "please enable js",
    "are you a robot",
    "captcha",
    "sorry, you have been blocked",
)


TITLE = re.compile(r"(?is)<title[^>]*>(.*?)</title>")
# An interstitial is a stub: a heading, a sentence, a retry. Anything with an
# article's worth of text is an article.
BLOCK_MAX_CHARS = 1500


def looks_blocked(body: str) -> bool:
    """Whether a non-empty body is an interstitial rather than the page.

    A bot-block, rate-limit or JS-wall page returns text and none of it is the
    source, so it must become a SKIP: calling it a FAIL accuses the corpus of
    something the fetch never tested.

    Length is half the test, not a refinement of it. Scanning for the signatures
    alone reads "request counters per IP address (for rate limiting purposes)"
    as a rate-limit page, which is how four sourced quotes in
    ``martin-kleppmann.md`` disappeared into SKIPs behind an article that had
    fetched perfectly. A title still decides on its own: a page called "429 Too
    Many Requests" is one however much boilerplate it carries.
    """
    title = TITLE.search(body)
    if title and _signed(html.unescape(title.group(1))):
        return True
    visible = strip_tags(body) if looks_like_html(body) else body
    return len(visible) <= BLOCK_MAX_CHARS and _signed(visible)


def _signed(text: str) -> bool:
    lowered = text.lower()
    return any(signature in lowered for signature in BLOCK_SIGNATURES)


@dataclass(frozen=True)
class Match:
    exact: bool
    window: int
    total: int

    def describe(self) -> str:
        if self.exact:
            return f"exact, {self.total} words"
        return f"best window {self.window}/{self.total} words"


def match(needle: str, haystack: str, fold: Callable[[str], str] = key) -> Match:
    """Longest run of the quote's words found in order on the page.

    ``fold`` is injected so a route's tolerance stays visible at the judging
    layer and ``match`` itself stays route-agnostic. It applies to both sides:
    a dossier that reproduces a caption's stutter must still match one that
    tidies it away.
    """
    words = fold(needle).split()
    if not words:
        return Match(False, 0, 0)
    padded = f" {fold(haystack)} "
    if f" {' '.join(words)} " in padded:
        return Match(True, len(words), len(words))
    for size in range(len(words) - 1, 0, -1):
        spans = (" ".join(words[i : i + size]) for i in range(len(words) - size + 1))
        if any(f" {span} " in padded for span in spans):
            return Match(False, size, len(words))
    return Match(False, 0, len(words))


PASS, FAIL, SKIP = "PASS", "FAIL", "SKIP"


@dataclass(frozen=True)
class Verdict:
    status: str
    reason: str
    window: int = 0
    total: int = 0


def classify(quote: str, kind: str, body: str | None, error: str | None) -> Verdict:
    """Judge one pointer. Anything the fetch did not test is a SKIP."""
    if error:
        return Verdict(SKIP, error)
    if body is None:
        return Verdict(SKIP, "nothing fetched")
    if looks_blocked(body):
        return Verdict(SKIP, "fetch returned a block or interstitial page")

    text = extract(kind, body)
    if not text.strip():
        return Verdict(SKIP, f"no text extracted from the {kind} body")

    result = match(quote, text, fold=caption_key if kind in CAPTION_ROUTES else key)
    if result.exact:
        return Verdict(PASS, result.describe(), result.window, result.total)
    if result.total >= MIN_WINDOW and result.window >= MIN_WINDOW:
        return Verdict(PASS, result.describe(), result.window, result.total)
    return Verdict(FAIL, result.describe(), result.window, result.total)


# --------------------------------------------------------------------------
# Shell
# --------------------------------------------------------------------------


class Cache:
    """Fetched bodies on disk, indexed by a readable manifest.

    The manifest is what lets ``tests/fixtures/pointers`` be reviewable: a
    content-addressed cache is fine for a throwaway run and unreadable in a repo,
    so the index maps cache key -> filename and fixtures are named by hand.
    """

    def __init__(self, directory: Path, offline: bool) -> None:
        self.dir = directory
        self.offline = offline
        self.manifest_path = directory / "manifest.json"
        self.manifest: dict[str, str] = {}
        if self.manifest_path.exists():
            self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))

    def get(self, cache_key: str) -> str | None:
        name = self.manifest.get(cache_key)
        if not name:
            return None
        path = self.dir / name
        return path.read_text(encoding="utf-8", errors="replace") if path.exists() else None

    def put(self, cache_key: str, body: str) -> None:
        name = self.manifest.get(cache_key) or f"{sha256(cache_key.encode()).hexdigest()[:16]}.txt"
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / name).write_text(body, encoding="utf-8")
        self.manifest[cache_key] = name
        self.manifest_path.write_text(
            json.dumps(dict(sorted(self.manifest.items())), indent=2) + "\n", encoding="utf-8"
        )


def cache_key(url: str, kind: str, primary: str) -> str:
    """One URL can hold two artefacts; the fragment names which one."""
    return url if kind == primary else f"{url}#{kind}"


def _run(command: list[str], timeout: int = FETCH_TIMEOUT) -> tuple[str | None, str | None]:
    try:
        done = subprocess.run(
            command,
            capture_output=True,
            text=True,
            # A page may serve any encoding it likes; a mangled character costs
            # at most one word of the haystack, a decode error costs the fetch.
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return None, f"{Path(command[0]).name} timed out after {timeout}s"
    except OSError as exc:
        return None, f"{Path(command[0]).name} failed to start: {exc}"
    if done.returncode != 0:
        detail = (done.stderr or done.stdout or "").strip().splitlines()
        last = detail[-1] if detail else ""
        return None, f"{Path(command[0]).name} exited {done.returncode}: {snippet(last, 80)}"
    return done.stdout, None


def _curl(url: str) -> tuple[str | None, str | None]:
    return _run(
        ["curl", "-fsSL", "--max-time", str(FETCH_TIMEOUT), "-A", USER_AGENT, url],
    )


def _require(tool: str) -> str | None:
    return None if shutil.which(tool) else f"{tool} is not installed, so this route cannot be read"


def fetch(url: str, kind: str) -> tuple[str | None, str | None]:
    """Retrieve one body. Returns (body, error); a missing tool is an error, not a FAIL."""
    if kind == "not_full_text":
        return None, "route yields no full text"

    if kind == "github_comment":
        if missing := _require("gh"):
            return None, missing
        # gh-gate's wrapper; a read-only token is enough for `gh api`.
        return _run(["gh", "api", "-H", "Accept: application/vnd.github+json", url])

    if kind == "pdf":
        if missing := _require("pdftotext"):
            return None, missing
        with tempfile.TemporaryDirectory() as work:
            # Straight to a file: a PDF is bytes, and decoding it as text to
            # hand on would corrupt it before pdftotext ever sees it.
            source = Path(work) / "pointer.pdf"
            _, error = _run(
                [
                    "curl",
                    "-fsSL",
                    "--max-time",
                    str(FETCH_TIMEOUT),
                    "-A",
                    USER_AGENT,
                    "-o",
                    str(source),
                    url,
                ]
            )
            if error is not None:
                return None, error
            return _run(["pdftotext", "-q", str(source), "-"])

    if kind == "youtube_captions":
        if missing := _require("yt-dlp"):
            return None, missing
        with tempfile.TemporaryDirectory() as work:
            _, error = _run(
                [
                    "yt-dlp",
                    "--skip-download",
                    "--write-auto-subs",
                    "--write-subs",
                    "--sub-langs",
                    "en.*",
                    "--sub-format",
                    "vtt",
                    "-o",
                    str(Path(work) / "captions"),
                    url,
                ],
                timeout=FETCH_TIMEOUT * 2,
            )
            tracks = sorted(Path(work).glob("*.vtt"))
            if not tracks:
                return None, error or "no English caption track published"
            return tracks[0].read_text(encoding="utf-8", errors="replace"), None

    if kind == "youtube_description":
        if missing := _require("yt-dlp"):
            return None, missing
        return _run(
            ["yt-dlp", "--skip-download", "--print", "description", url],
            timeout=FETCH_TIMEOUT * 2,
        )

    return _curl(url)


def body_for(url: str, kind: str, primary: str, cache: Cache) -> tuple[str | None, str | None]:
    """Cached body, fetching only when the cache misses and we may go online."""
    slot = cache_key(url, kind, primary)
    cached = cache.get(slot)
    if cached is not None:
        return cached, None
    if cache.offline:
        return None, "not in cache (--offline)"
    body, error = fetch(url, kind)
    if body is not None:
        cache.put(slot, body)
    return body, error


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------


@dataclass
class Result:
    line: int
    quote: str
    pointer: str
    kind: str
    verdict: Verdict


def verify_quote(quote: Quote, cache: Cache) -> Result:
    attribution = quote.attribution or ""
    found = URL.search(attribution)
    if not found:
        # A book page or a print citation names no fetchable artefact; the
        # grammar accepts it and nothing here can confirm it.
        return Result(quote.line, quote.text, "", "-", Verdict(SKIP, "pointer names no URL"))

    pointer = found.group().rstrip(".,;)")
    plan = route(pointer)
    if plan.kind == "not_full_text":
        return Result(quote.line, quote.text, pointer, plan.kind, Verdict(SKIP, plan.reason))

    attempts = []
    for kind in (plan.kind, *plan.alternates):
        body, error = body_for(plan.url, kind, plan.kind, cache)
        verdict = classify(quote.text, kind, body, error)
        if verdict.status == PASS:
            return Result(quote.line, quote.text, pointer, kind, verdict)
        attempts.append((kind, verdict))

    # No attempt confirmed it: report the most informative one. A FAIL says the
    # words were looked for and were absent; a SKIP says they were never tested.
    kind, verdict = max(attempts, key=lambda item: (item[1].status == FAIL, item[1].window))
    return Result(quote.line, quote.text, pointer, kind, verdict)


def verify_file(path: Path, cache: Cache) -> list[Result]:
    quotes = parse_quotes(path.read_text(encoding="utf-8").splitlines())
    return [verify_quote(q, cache) for q in quotes if q.status in NEEDS_POINTER]


def snippet(text: str, width: int = 68) -> str:
    return text if len(text) <= width else text[: width - 3] + "..."


def report(path: Path, results: list[Result], root: Path) -> None:
    try:
        shown = path.relative_to(root)
    except ValueError:
        shown = path
    print(f"\nverify-pointers: {shown}")
    for result in results:
        print(
            f"  {result.verdict.status}  {result.line:>4}  {result.kind:<18} {result.verdict.reason}"
        )
        if result.verdict.status != PASS:
            print(f'        "{snippet(result.quote)}"')
            if result.pointer:
                print(f"        {result.pointer}")
    counts = tally(results)
    print(
        f"verify-pointers: {path.name}: "
        f"{counts[PASS]} pass, {counts[FAIL]} fail, {counts[SKIP]} skip"
    )


def tally(results: list[Result]) -> dict[str, int]:
    counts = {PASS: 0, FAIL: 0, SKIP: 0}
    for result in results:
        counts[result.verdict.status] += 1
    return counts


def as_json(reports: list[tuple[Path, list[Result]]]) -> str:
    payload = {
        "files": [
            {
                "file": str(path),
                "results": [
                    {
                        "line": r.line,
                        "status": r.verdict.status,
                        "route": r.kind,
                        "reason": r.verdict.reason,
                        "window": r.verdict.window,
                        "words": r.verdict.total,
                        "url": r.pointer,
                        "quote": r.quote,
                    }
                    for r in results
                ],
            }
            for path, results in reports
        ],
        "summary": tally([r for _, results in reports for r in results]),
    }
    return json.dumps(payload, indent=2)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--all", action="store_true", help="verify every dossier")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--cache", type=Path, help="directory of fetched bodies")
    parser.add_argument(
        "--offline", action="store_true", help="never fetch; a cache miss is a SKIP"
    )
    parser.add_argument("--json", action="store_true", help="machine-readable report")
    parser.add_argument(
        "--strict", action="store_true", help="exit 1 if anything FAILs (default: always 0)"
    )
    args = parser.parse_args(argv)

    if args.all:
        targets = sorted(p for p in (args.root / "references").glob("*.md") if is_dossier(p))
    else:
        targets = [p for p in args.files if p.suffix == ".md" and p.exists() and is_dossier(p)]

    if not targets:
        return 0

    directory = args.cache or Path(tempfile.gettempdir()) / "summon-verify-pointers"
    if not args.offline:
        directory.mkdir(parents=True, exist_ok=True)
    cache = Cache(directory, offline=args.offline)

    reports = [(path, verify_file(path, cache)) for path in targets]

    if args.json:
        print(as_json(reports))
    else:
        for path, results in reports:
            report(path, results, args.root)
        if len(reports) > 1:
            totals = tally([r for _, results in reports for r in results])
            print(
                f"\nverify-pointers: {len(reports)} dossiers: "
                f"{totals[PASS]} pass, {totals[FAIL]} fail, {totals[SKIP]} skip"
            )

    failed = any(r.verdict.status == FAIL for _, results in reports for r in results)
    # A FAIL is 'look closer', not 'the corpus is wrong'. Exiting non-zero by
    # default would teach the next author to read it as a verdict.
    return 1 if (failed and args.strict) else 0


if __name__ == "__main__":
    sys.exit(main())
