#!/usr/bin/env python3
"""evidence-block.py: three subcommands for PR body evidence.

  files    ROW... [--by NAME] [--body FILE]   render rows of local captures
  hosted   ROW... [--by NAME] [--body FILE]   render rows of uploaded videos
  uploads  ROW...                             print the gh --attach paths

ROW is `--pair OLD NEW` or `--new NEW`, optionally followed by
`--caption TEXT` for that row. With --body, the rendered lines are spliced
into the body text and the full body is printed; otherwise only the
rendered lines are printed.

Reads local files only and writes to stdout. No capture, no network. Run it
from the directory gh runs from, because local paths print relative to it.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, replace
from enum import Enum
from pathlib import Path
from urllib.parse import urlparse

OPEN_MARK = "<!-- evidence-block v1 -->"
CLOSE_MARK = "<!-- end evidence-block -->"

STILL_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
CLIP_SUFFIXES = frozenset({".mp4", ".mov", ".webm"})

# Characters that would break the table, the HTML cells or the bold/italic
# wrappers, or fake a Markdown link inside the rendered block.
FORBIDDEN = frozenset("|<>&[]*_`\\")

LINE = re.compile(r"[^\n]*\n|[^\n]+\Z")


class EvidenceError(Exception):
    """An input problem. The message says what to change."""


class Media(Enum):
    STILL = "still"
    CLIP = "clip"


@dataclass(frozen=True)
class Row:
    new: str
    old: str | None = None
    caption: str | None = None

    def sides(self) -> list[tuple[str, str]]:
        if self.old is None:
            return [("New", self.new)]
        return [("Before", self.old), ("After", self.new)]


Section = tuple[str | None, list[str]]


# --- CLI --------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    try:
        out = run(sys.argv[1:] if argv is None else argv, Path.cwd())
    except EvidenceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    sys.stdout.buffer.write(out.encode("utf-8"))
    sys.stdout.flush()
    return 0


def run(argv: list[str], cwd: Path) -> str:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_usage(sys.stderr)
        raise SystemExit(2)
    if not args.rows:
        raise EvidenceError("no rows given; add --pair OLD NEW or --new NEW")
    if args.command == "uploads":
        return "".join(f"{ref}\n" for ref in upload_refs(args.rows, cwd))
    if args.command == "files":
        sections = file_sections(args.rows, cwd)
    else:
        sections = hosted_sections(args.rows)
    block = compose(sections, args.by)
    if args.body is None:
        return "\n".join(block) + "\n"
    return splice(read_body(args.body), block)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="evidence-block.py",
        description="files and hosted print the marked PR body lines; uploads lists gh --attach paths.",
    )
    subs = parser.add_subparsers(dest="command", metavar="{files,hosted,uploads}")
    for name, what, text in (
        ("files", "local files", "render local images (tables) and videos (stacked clips)"),
        ("hosted", "uploaded video URLs", "render uploaded videos as an HTML table"),
    ):
        sub = subs.add_parser(name, help=text)
        add_rows(sub, what)
        sub.add_argument("--by", metavar="NAME", help="end the block with who captured it")
        sub.add_argument("--body", metavar="FILE", help="PR body to splice into; print the result")
    add_rows(subs.add_parser("uploads", help="print one gh --attach path per line"), "local files")
    return parser


def add_rows(sub: argparse.ArgumentParser, what: str) -> None:
    sub.set_defaults(rows=[])
    sub.add_argument(
        "--pair",
        nargs=2,
        action=AddRow,
        metavar=("OLD", "NEW"),
        help=f"a before/after row of {what}",
    )
    sub.add_argument("--new", action=AddRow, metavar="NEW", help=f"an after-only row of {what}")
    sub.add_argument(
        "--caption", action=SetCaption, metavar="TEXT", help="caption for the row before"
    )


class AddRow(argparse.Action):
    def __call__(self, parser, namespace, values, option_string=None):
        old, new = values if isinstance(values, list) else (None, values)
        namespace.rows = [*namespace.rows, Row(new=new, old=old)]


class SetCaption(argparse.Action):
    def __call__(self, parser, namespace, values, option_string=None):
        rows = list(namespace.rows)
        if not rows:
            raise EvidenceError("--caption labels the row before it; put --pair or --new first")
        if rows[-1].caption is not None:
            raise EvidenceError(f"row {len(rows)} has two --caption flags; keep one")
        rows[-1] = replace(rows[-1], caption=check_text("caption", values))
        namespace.rows = rows


# --- splicing into a body ---------------------------------------------------


def read_body(path: str) -> str:
    try:
        with open(path, encoding="utf-8", newline="") as fh:
            return fh.read()
    except UnicodeDecodeError:
        raise EvidenceError(f"{path} is not UTF-8 text; save it as UTF-8, then rerun") from None
    except OSError as exc:
        raise EvidenceError(f"cannot read {path}: {exc.strerror}") from None


def splice(body: str, block: list[str]) -> str:
    """Put block into body. Lines outside the markers are copied verbatim, line endings included."""
    lines = LINE.findall(body)
    eol = "\r\n" if "\r\n" in body else "\n"
    text = eol.join(block) + eol
    opens = [i for i, line in enumerate(lines) if line.strip() == OPEN_MARK]
    closes = [i for i, line in enumerate(lines) if line.strip() == CLOSE_MARK]
    if not opens and not closes:
        if not body.strip():
            return text
        head = body if body.endswith("\n") else body + eol
        if lines[-1].strip():
            head += eol
        return head + text
    if len(opens) != 1 or len(closes) != 1:
        raise EvidenceError(
            f"body has {len(opens)} open and {len(closes)} close marker lines; "
            "leave one of each, or neither, then rerun"
        )
    first, last = opens[0], closes[0]
    if last < first:
        raise EvidenceError("the close marker line sits above the open marker line; swap them")
    return "".join(lines[:first]) + text + "".join(lines[last + 1 :])


# --- inputs -----------------------------------------------------------------


def resolve(arg: str, root: Path) -> tuple[Media, str]:
    """The media kind and the ./-relative path that gh matches against its --attach list."""
    suffix = Path(arg).suffix.lower()
    if suffix in STILL_SUFFIXES:
        media = Media.STILL
    elif suffix in CLIP_SUFFIXES:
        media = Media.CLIP
    else:
        known = " ".join(sorted(STILL_SUFFIXES | CLIP_SUFFIXES))
        raise EvidenceError(f"cannot embed {arg}: convert it to one of {known}")
    given = Path(arg)
    target = (given if given.is_absolute() else root / given).resolve()
    if not target.is_file():
        raise EvidenceError(f"no such file: {arg}")
    base = root.resolve()
    if not target.is_relative_to(base):
        raise EvidenceError(f"{arg} resolves to {target}; move it under {base}, where gh runs")
    ref = f"./{target.relative_to(base).as_posix()}"
    if re.search(r"\s", ref):
        raise EvidenceError(f"gh cannot match {ref!r} because of whitespace; rename it")
    return media, ref


def resolve_files(rows: list[Row], root: Path) -> list[tuple[Row, Media, list[tuple[str, str]]]]:
    out = []
    for n, row in enumerate(rows, 1):
        resolved = [(name, *resolve(path, root)) for name, path in row.sides()]
        kinds = {media for _, media, _ in resolved}
        if len(kinds) > 1:
            raise EvidenceError(
                f"row {n} puts an image beside a video ({row.old}, {row.new}); pair like with like"
            )
        out.append((row, kinds.pop(), [(name, ref) for name, _, ref in resolved]))
    return out


def check_url(url: str) -> str:
    parts = urlparse(url)
    if (
        parts.scheme != "https"
        or parts.netloc != "github.com"
        or not parts.path.startswith("/user-attachments/assets/")
        or re.search(r"[\s\"<>]", url)
    ):
        raise EvidenceError(
            f"use an https://github.com/user-attachments/assets/... URL for hosted rows: {url}"
        )
    return url


def check_text(what: str, text: str) -> str:
    bad = not text.strip() or any(ch in FORBIDDEN or ord(ch) < 32 or ord(ch) == 127 for ch in text)
    if bad:
        raise EvidenceError(
            f"{what} {text!r}: write plain words without | < > & [ ] * _ ` \\ or line breaks"
        )
    return text


def upload_refs(rows: list[Row], root: Path) -> list[str]:
    seen: dict[str, None] = {}
    for _, _, sides in resolve_files(rows, root):
        seen.update((ref, None) for _, ref in sides)
    return list(seen)


# --- rendering --------------------------------------------------------------


def file_sections(rows: list[Row], root: Path) -> list[Section]:
    renderers = {Media.STILL: md_table, Media.CLIP: paragraphs}
    return [
        (row.caption, renderers[media](sides)) for row, media, sides in resolve_files(rows, root)
    ]


def hosted_sections(rows: list[Row]) -> list[Section]:
    return [
        (row.caption, html_table([(name, check_url(url)) for name, url in row.sides()]))
        for row in rows
    ]


def compose(sections: list[Section], by: str | None) -> list[str]:
    lines = [OPEN_MARK]
    for caption, body in sections:
        if caption:
            lines += [f"**{caption}**", ""]
        lines += [*body, ""]
    if by:
        lines += [f"_Captured by {check_text('--by', by)}_", ""]
    return [*lines, CLOSE_MARK]


def md_table(sides: list[tuple[str, str]]) -> list[str]:
    return [
        "| " + " | ".join(name for name, _ in sides) + " |",
        "| " + " | ".join("---" for _ in sides) + " |",
        "| " + " | ".join(f"![{name}]({ref})" for name, ref in sides) + " |",
    ]


def paragraphs(sides: list[tuple[str, str]]) -> list[str]:
    # gh rewrites only Markdown image syntax, and a table cell would not play
    # the video, so clips stack vertically, each under a plain lead-in line.
    out: list[str] = []
    for name, ref in sides:
        if out:
            out.append("")
        out += [f"{name}:", "", f"![{name}]({ref})"]
    return out


def html_table(sides: list[tuple[str, str]]) -> list[str]:
    heads = "".join(f"<th>{name}</th>" for name, _ in sides)
    cells = "".join(f'<td><video controls src="{url}"></video></td>' for _, url in sides)
    return ["<table>", f"<tr>{heads}</tr>", f"<tr>{cells}</tr>", "</table>"]


if __name__ == "__main__":
    sys.exit(main())
