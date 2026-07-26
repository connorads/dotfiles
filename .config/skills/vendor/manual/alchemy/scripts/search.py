#!/usr/bin/env python3
"""Search the vendored Alchemy documentation with metadata-first ranking."""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path


TOKEN_RE = re.compile(r"[a-z0-9]+")
HEADING_RE = re.compile(r"^#{2,6}\s+(.+?)\s*$")


@dataclass(frozen=True)
class Document:
    path: Path
    title: str
    description: str
    headings: tuple[str, ...]
    body: str


@dataclass(frozen=True)
class Match:
    score: int
    document: Document
    matched_headings: tuple[str, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Search the vendored alchemy-run/alchemy documentation."
    )
    parser.add_argument("query", nargs="+", help="terms to search for")
    parser.add_argument(
        "--area", help="restrict results to a top-level area such as cloudflare or aws"
    )
    parser.add_argument(
        "--limit", type=int, default=8, help="maximum results to print (default: 8)"
    )
    args = parser.parse_args()
    if not 1 <= args.limit <= 50:
        parser.error("--limit must be between 1 and 50")
    return args


def normalise(value: str) -> str:
    return " ".join(TOKEN_RE.findall(value.lower()))


def scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_document(path: Path) -> Document:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    title = path.stem
    description = ""
    body_start = 0
    if lines and lines[0] == "---":
        try:
            end = lines.index("---", 1)
        except ValueError:
            end = 0
        if end:
            for line in lines[1:end]:
                if line.startswith("title:"):
                    title = scalar(line.removeprefix("title:"))
                elif line.startswith("description:"):
                    description = scalar(line.removeprefix("description:"))
            body_start = end + 1

    headings: list[str] = []
    in_fence = False
    for line in lines[body_start:]:
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_fence = not in_fence
            continue
        if not in_fence and (match := HEADING_RE.match(line)):
            headings.append(match.group(1))
    return Document(path, title, description, tuple(headings), text)


def score_document(
    document: Document, query: str, tokens: tuple[str, ...]
) -> Match | None:
    filename = normalise(document.path.stem.replace("--", " "))
    title = normalise(document.title)
    description = normalise(document.description)
    headings = tuple(normalise(heading) for heading in document.headings)
    body = normalise(document.body)
    score = 0
    covered: set[str] = set()
    matched_headings: list[str] = []

    for token in tokens:
        token_hit = False
        if token in filename:
            score += 12
            token_hit = True
        if token in title:
            score += 10
            token_hit = True
        if token in description:
            score += 7
            token_hit = True
        for original, heading in zip(document.headings, headings, strict=True):
            if token in heading:
                score += 4
                token_hit = True
                if original not in matched_headings:
                    matched_headings.append(original)
        if token in body:
            score += 1
            token_hit = True
        if token_hit:
            covered.add(token)

    if not covered:
        return None
    if len(covered) == len(tokens):
        score += 20
    phrase = normalise(query)
    if phrase and phrase in filename:
        score += 8
    if phrase and phrase in title:
        score += 8
    if phrase and phrase in description:
        score += 4
    return Match(score, document, tuple(matched_headings[:3]))


def main() -> int:
    args = parse_args()
    references = Path(__file__).resolve().parents[1] / "references"
    if not references.is_dir():
        print(
            "Alchemy references are missing; run scripts/update.py --apply first.",
            file=sys.stderr,
        )
        return 2

    query = " ".join(args.query)
    tokens = tuple(dict.fromkeys(TOKEN_RE.findall(query.lower())))
    if not tokens:
        print("Search query contains no searchable terms.", file=sys.stderr)
        return 2

    matches: list[Match] = []
    area_prefix = f"{args.area.lower()}--" if args.area else None
    for path in sorted(references.iterdir()):
        if path.suffix not in {".md", ".mdx"}:
            continue
        if area_prefix and not path.name.lower().startswith(area_prefix):
            continue
        document = parse_document(path)
        if match := score_document(document, query, tokens):
            matches.append(match)

    matches.sort(key=lambda match: (-match.score, match.document.path.name))
    if not matches:
        area = f" in area {args.area!r}" if args.area else ""
        print(f"No matching Alchemy references{area}.", file=sys.stderr)
        return 1

    skill_root = Path(__file__).resolve().parents[1]
    for index, match in enumerate(matches[: args.limit], start=1):
        document = match.document
        print(f"{index}. {document.title} [score {match.score}]")
        print(f"  {document.path.relative_to(skill_root).as_posix()}")
        if document.description:
            print(f"  {document.description}")
        if match.matched_headings:
            print(f"  Headings: {'; '.join(match.matched_headings)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
