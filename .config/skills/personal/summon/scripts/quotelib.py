"""Read the attribution grammar out of a dossier.

The parsing half of ``references/attribution.md``: what counts as a quotation,
where its attribution line sits, and how two spellings of the same words fold to
one comparison key. It holds no opinion about whether a quote is *acceptable* -
that judgement lives in ``check-quotes.py``, and what the words point *at* lives
in ``verify-pointers.py``. Both import from here so there is one parser.

No dash in the module name so ``import quotelib`` resolves: CPython puts the
running script's own directory on ``sys.path``, and every caller runs these
scripts by path. A caller that loads one of them via ``spec_from_file_location``
must put ``scripts/`` on ``sys.path`` itself.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path

STATUSES = ("verbatim", "attributed", "paraphrase", "extrapolation", "misattributed")
NEEDS_POINTER = ("verbatim", "attributed")

# Straight and curly quote glyphs, as escapes: the literals are visually ambiguous.
QUOTE_GLYPHS = "\"'`\u2018\u2019\u201c\u201d"

# Quote syntaxes observed in the corpus. All of them wear quotation marks, so all
# of them make the same claim and all of them are checked.
QUOTE_PATTERNS = (
    re.compile(r'^\s*>\s*[""“”](?P<quote>.+)$'),  # > "..."      blockquote
    re.compile(r'^[""“”](?P<quote>.{25,})$'),  # "..."        bare line
    re.compile(r'^\s*\d+\.\s+\*\*[""“”](?P<quote>.{25,})$'),  # 1. **"..."**  numbered
)

# Inline quoted strings - the same claim made mid-sentence. The corpus carries
# more of these than line-level ones, and the Contrarian Takes sections, the
# highest-yield seam for fabrication, are written entirely in this syntax.
INLINE_MIN_CHARS = 25
# A quotation opens and closes at a word boundary. Without the lookarounds the
# scan opens on the CLOSING glyph of one scare-quoted term and closes on the
# OPENING glyph of the next, so the prose between two terms of art reads as a
# quotation nobody wrote.
INLINE_QUOTE = re.compile(
    rf'(?<!\w)"(?P<straight>[^"\n]{{{INLINE_MIN_CHARS},}})"(?!\w)'
    rf"|(?<!\w)“(?P<curly>[^“”\n]{{{INLINE_MIN_CHARS},}})”(?!\w)"
)
INLINE_CODE = re.compile(r"`[^`\n]*`")
QUOTE_GLYPH_IN_CODE = re.compile(r"[\"“”]")

ATTRIBUTION = re.compile(r"^\s*(?:--|—)\s*(?P<body>.+)$")
STATUS_TOKEN = re.compile(rf"^\s*(?P<status>{'|'.join(STATUSES)})\b", re.IGNORECASE)

URL = re.compile(r"https?://\S+")
PAGE = re.compile(r"\bp{1,2}\.?\s*\d+", re.IGNORECASE)
TIMESTAMP = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b")

CLOSING_GLYPH = re.compile(r'[""“”]')


@dataclass
class Quote:
    line: int
    text: str
    status: str | None = None
    attribution: str | None = None


def normalise(text: str) -> str:
    """Fold a quote to a comparison key: quote glyphs, whitespace, case, accents.

    Deliberately keeps ``_`` (a ``\\w`` character). Markdown emphasis therefore
    survives, which is right here - the inline-twin rule compares two spellings
    of the *same file's* prose, and folding emphasis away would move the gate's
    baseline. Fetched pages need the emphasis stripped as well; that is
    ``verify-pointers.strip_emphasis``, layered on top of this and never inside it.
    """
    text = unicodedata.normalize("NFKD", text)
    text = re.sub(f"[{re.escape(QUOTE_GLYPHS)}]", "", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.lower().split())


def split_quote(remainder: str) -> tuple[str, str]:
    """Split a matched line into (quote text, trailing tail).

    Anchors on the last closing quote glyph rather than on a dash: quotes
    routinely contain em-dashes of their own, and splitting on those silently
    truncates the quote and invents an attribution out of its second half.
    """
    remainder = remainder.rstrip()
    closes = list(CLOSING_GLYPH.finditer(remainder))
    if not closes:
        return remainder, ""
    last = closes[-1]
    tail = remainder[last.end() :].strip()
    return remainder[: last.start()].rstrip(), re.sub(r"^\*\*", "", tail).strip()


def parse_quotes(lines: list[str]) -> list[Quote]:
    quotes: list[Quote] = []
    in_fence = False
    for i, raw in enumerate(lines):
        if raw.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        for pattern in QUOTE_PATTERNS:
            match = pattern.match(raw.rstrip("\n"))
            if not match:
                continue
            text, tail = split_quote(match.group("quote"))
            quote = Quote(line=i + 1, text=text)

            # An attribution may trail the quote line itself, or sit on the next
            # non-blank line.
            trailing = ATTRIBUTION.match(tail) if tail else None
            if trailing:
                quote.attribution = trailing.group("body").strip()
            else:
                for nxt in lines[i + 1 : i + 3]:
                    if not nxt.strip():
                        continue
                    following = ATTRIBUTION.match(nxt)
                    if following:
                        quote.attribution = following.group("body").strip()
                    break

            if quote.attribution:
                token = STATUS_TOKEN.match(quote.attribution)
                if token:
                    quote.status = token.group("status").lower()
            quotes.append(quote)
            break
    return quotes


def strip_inline_code(line: str) -> str:
    """Unwrap inline-code spans, blanking only those carrying quote glyphs.

    A code span sits inside a quotation often enough (`debugger`) that dropping
    the span wholesale would mangle the quote's text and lose the twin it should
    inherit from. A span that contains quote marks is a code sample instead, and
    the marks in it are syntax, not a quotation.
    """
    return INLINE_CODE.sub(
        lambda m: " " if QUOTE_GLYPH_IN_CODE.search(m.group()) else m.group()[1:-1], line
    )


def parse_inline_quotes(lines: list[str]) -> list[Quote]:
    """Quoted strings embedded in prose, as against ones that own their line.

    Skips code fences and inline code spans, attribution lines (a cited article
    title is metadata, not the persona's voice), and any line the line-level
    patterns already claim.
    """
    quotes: list[Quote] = []
    in_fence = False
    for i, raw in enumerate(lines):
        line = raw.rstrip("\n")
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence or ATTRIBUTION.match(line):
            continue
        if any(pattern.match(line) for pattern in QUOTE_PATTERNS):
            continue
        for match in INLINE_QUOTE.finditer(strip_inline_code(line)):
            text = match.group("straight") or match.group("curly")
            quotes.append(Quote(line=i + 1, text=text))
    return quotes


def is_dossier(path: Path) -> bool:
    """A persona file, as against a reference doc that happens to live here."""
    return not path.name.startswith("_") and "\n## Aliases" in path.read_text(encoding="utf-8")
