#!/usr/bin/env python3
"""Enforce the attribution grammar on summon persona dossiers.

See ``references/attribution.md`` for the grammar itself.

The corpus predates the grammar, so the gate ratchets rather than blocking: each
file carries a baseline count of unsourced quotes in ``scripts/quote-baseline.json``
and the check fails only when a file goes *above* its baseline. Adding a sourced
quote is always free; adding an unsourced one is not.

Usage:
    check-quotes.py --all                  every dossier
    check-quotes.py FILE...                just these (what the hk step passes)
    check-quotes.py --all --update-baseline    record current counts
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

STATUSES = ("verbatim", "attributed", "paraphrase", "extrapolation", "misattributed")
NEEDS_POINTER = ("verbatim", "attributed")

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
INLINE_QUOTE = re.compile(
    rf'"(?P<straight>[^"\n]{{{INLINE_MIN_CHARS},}})"'
    rf"|“(?P<curly>[^“”\n]{{{INLINE_MIN_CHARS},}})”"
)
INLINE_CODE = re.compile(r"`[^`\n]*`")
QUOTE_GLYPH_IN_CODE = re.compile(r"[\"“”]")

ATTRIBUTION = re.compile(r"^\s*(?:--|—)\s*(?P<body>.+)$")
STATUS_TOKEN = re.compile(rf"^\s*(?P<status>{'|'.join(STATUSES)})\b", re.IGNORECASE)
PARAPHRASE_MARKER = re.compile(r"\(paraphrase\)", re.IGNORECASE)

URL = re.compile(r"https?://\S+")
PAGE = re.compile(r"\bp{1,2}\.?\s*\d+", re.IGNORECASE)
TIMESTAMP = re.compile(r"\b\d{1,2}:\d{2}(?::\d{2})?\b")

# Attribution shapes that name no locatable artefact. These are the ones that
# passed a presence check while pointing at nothing.
DENIED = (
    (re.compile(r"\bvarious\b", re.IGNORECASE), "'various ...' names no artefact"),
    (
        re.compile(r"\bwidely (?:quoted|cited|attributed)", re.IGNORECASE),
        "'widely ...' is not a source",
    ),
    (
        re.compile(r"\battributed to\b", re.IGNORECASE),
        "'attributed to' is an admission, not a citation",
    ),
    (re.compile(r"\boften quoted as\b", re.IGNORECASE), "'often quoted as' is not a source"),
    (re.compile(r"\bvariously reported\b", re.IGNORECASE), "'variously reported' is not a source"),
    (re.compile(r"^\s*(?:on|about)\s+\w+", re.IGNORECASE), "bare topic label, not a source"),
    (
        re.compile(r"\bin an interview\b(?!.*\b(?:19|20)\d{2}\b)", re.IGNORECASE),
        "'in an interview' with no publication or date",
    ),
    (
        re.compile(r"\bhis (?:blog|talks|writing)\b", re.IGNORECASE),
        "names a body of work, not one artefact",
    ),
)

MAX_QUOTE_WORDS = 50

# Straight and curly quote glyphs, as escapes: the literals are visually ambiguous.
QUOTE_GLYPHS = "\"'`\u2018\u2019\u201c\u201d"

# "Dijkstra quote he references constantly" - an attribution that says out loud
# the words are someone else's, sitting under a heading called Sourced Quotes.
BORROWED = re.compile(
    r"\b(?:quote|line|aphorism|saying|maxim)\b[^|]{0,40}\b(?:he|she|they)\s+"
    r"(?:references?|champions?|quotes?|cites?|likes?|repeats?|invokes?)",
    re.IGNORECASE,
)
# An explicit relay marker makes naming another person legitimate.
RELAY = re.compile(
    r"\b(?:via|as quoted in|quoted by|quoting|reporting|interviewed by)\b", re.IGNORECASE
)


@dataclass
class Violation:
    path: Path
    line: int
    code: str
    detail: str
    quote: str

    def __str__(self) -> str:
        snippet = self.quote if len(self.quote) <= 60 else self.quote[:57] + "..."
        return f"{self.path}:{self.line}: {self.code}: {self.detail}\n    {snippet}"


@dataclass
class Quote:
    line: int
    text: str
    status: str | None = None
    attribution: str | None = None


@dataclass
class FileReport:
    path: Path
    violations: list[Violation] = field(default_factory=list)

    @property
    def baseline_count(self) -> int:
        """Violations that the baseline may forgive - the pre-existing debt."""
        return sum(1 for v in self.violations if v.code != "STATUS-CONFLICT")


def normalise(text: str) -> str:
    """Fold a quote to a comparison key: quote glyphs, whitespace, case, accents."""
    text = unicodedata.normalize("NFKD", text)
    text = re.sub(f"[{re.escape(QUOTE_GLYPHS)}]", "", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.lower().split())


CLOSING_GLYPH = re.compile(r'[""“”]')


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


def aliases_of(path: Path) -> set[str]:
    """The lowercased names in a dossier's ## Aliases list, plus its filename."""
    names: set[str] = set()
    in_section = False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            in_section = line.strip().lower() == "## aliases"
            continue
        if in_section and line.strip().startswith("- "):
            names.add(line.strip()[2:].strip().lower())
    names.add(path.stem.replace("-", " "))
    return names


def identifying_names(path: Path) -> set[str]:
    """Names specific enough to identify this persona in someone else's citation.

    Full names, and the surname from the filename. Deliberately NOT bare first
    names: 'Kent C. Dodds' is not Kent Beck, and 'April 2015' is a date.
    """
    names = {n for n in aliases_of(path) if " " in n and len(n) > 6}
    surname = path.stem.rsplit("-", 1)[-1]
    if len(surname) >= 4:
        names.add(surname)
    return names


def other_persona_names(path: Path) -> set[str]:
    """Every identifying roster name that is not this dossier's own.

    Naming one of these in an attribution, with no relay marker, is the shape of
    the corpus's most common defect: a colleague's line handed to the more
    famous name in the same field.
    """
    mine = aliases_of(path)
    others: set[str] = set()
    for sibling in path.parent.glob("*.md"):
        if sibling == path or not is_dossier(sibling):
            continue
        others |= identifying_names(sibling)
    return others - mine


def check_file(path: Path) -> FileReport:
    report = FileReport(path=path)
    lines = path.read_text(encoding="utf-8").splitlines()
    quotes = parse_quotes(lines)
    strangers = other_persona_names(path)

    def flag(quote: Quote, code: str, detail: str) -> None:
        report.violations.append(Violation(path, quote.line, code, detail, quote.text))

    for quote in quotes:
        attribution = quote.attribution

        if not attribution:
            flag(quote, "NO-SOURCE", "quotation with no attribution line")
            continue

        if PARAPHRASE_MARKER.search(attribution):
            continue  # explicitly demoted; the router never quotes it

        for pattern, reason in DENIED:
            if pattern.search(attribution):
                flag(quote, "WEASEL", reason)
                break

        if quote.status != "misattributed" and not RELAY.search(attribution):
            if BORROWED.search(attribution):
                flag(quote, "CROSS-NAME", "attribution says the words are someone else's")
            else:
                lowered = attribution.lower()
                stranger = next(
                    (n for n in strangers if re.search(rf"\b{re.escape(n)}\b", lowered)), None
                )
                if stranger:
                    flag(
                        quote,
                        "CROSS-NAME",
                        f"attribution names '{stranger}', who has their own dossier",
                    )

        if quote.status is None:
            flag(quote, "NO-STATUS", f"attribution lacks a status token ({', '.join(STATUSES)})")
        elif quote.status in NEEDS_POINTER and not (
            URL.search(attribution) or PAGE.search(attribution) or TIMESTAMP.search(attribution)
        ):
            flag(quote, "NO-POINTER", f"'{quote.status}' needs a URL, a page, or a timestamp")

        if len(quote.text.split()) > MAX_QUOTE_WORDS:
            flag(
                quote,
                "TOO-LONG",
                f"quote is {len(quote.text.split())} words (cap {MAX_QUOTE_WORDS})",
            )

    # An inline string inherits from its line-level twin: the corpus is written
    # by sourcing a line once and restating it in prose, and the twin already
    # carries the file's judgement on those words. One with no twin anywhere in
    # the file asserts a quotation the file never accounts for.
    twins = {key for quote in quotes if (key := normalise(quote.text))}
    for inline in parse_inline_quotes(lines):
        key = normalise(inline.text)
        if key and key not in twins:
            flag(inline, "INLINE-ORPHAN", "quoted in prose with no line-level twin in this file")

    # One quote, one status, everywhere in the file. Without this a fabrication
    # gets sourced once and restated bare three times.
    seen: dict[str, Quote] = {}
    for quote in quotes:
        key = normalise(quote.text)
        if not key:
            continue
        first = seen.setdefault(key, quote)
        if first is not quote and first.status != quote.status:
            report.violations.append(
                Violation(
                    path,
                    quote.line,
                    "STATUS-CONFLICT",
                    f"same quote is '{quote.status or 'unmarked'}' here but "
                    f"'{first.status or 'unmarked'}' at line {first.line}",
                    quote.text,
                )
            )
    return report


def load_baseline(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get("files", {})


def save_baseline(path: Path, counts: dict[str, int]) -> None:
    payload = {
        "_comment": (
            "Pre-existing unsourced quotes per dossier. The gate fails when a file goes "
            "above its number, so this may only ratchet down. Regenerate with "
            "scripts/check-quotes.py --all --update-baseline."
        ),
        "files": dict(sorted(counts.items())),
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("files", nargs="*", type=Path)
    parser.add_argument("--all", action="store_true", help="check every dossier")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--baseline", type=Path)
    parser.add_argument(
        "--update-baseline", action="store_true", help="record current counts as the new baseline"
    )
    args = parser.parse_args(argv)

    baseline_path = args.baseline or args.root / "scripts" / "quote-baseline.json"

    if args.all:
        targets = sorted(p for p in (args.root / "references").glob("*.md") if is_dossier(p))
    else:
        targets = [p for p in args.files if p.suffix == ".md" and p.exists() and is_dossier(p)]

    if not targets:
        return 0

    baseline = load_baseline(baseline_path)
    reports = [check_file(path) for path in targets]

    if args.update_baseline:
        counts = baseline | {r.path.name: r.baseline_count for r in reports}
        save_baseline(baseline_path, {k: v for k, v in counts.items() if v})
        print(f"check-quotes: baseline written to {baseline_path}")
        return 0

    failed = False
    for report in reports:
        allowed = baseline.get(report.path.name, 0)
        current = report.baseline_count
        hard = [v for v in report.violations if v.code == "STATUS-CONFLICT"]

        if current > allowed:
            failed = True
            print(
                f"\ncheck-quotes: {report.path.name}: {current} unsourced quotes, baseline allows {allowed}"
            )
            # Bounded output: the harness truncates, so show the newest offenders only.
            for violation in report.violations[:10]:
                print(violation)
            if len(report.violations) > 10:
                print(f"    ... and {len(report.violations) - 10} more")
        elif current < allowed:
            print(
                f"check-quotes: {report.path.name}: improved to {current} (baseline {allowed}) - run --update-baseline"
            )

        for violation in hard:
            failed = True
            print(violation)

    if failed:
        print("\nSee references/attribution.md for the grammar.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
