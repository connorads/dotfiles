#!/usr/bin/env python3
"""Build a .termctrl recording from a small authored steps file.

Input JSON (via --in FILE or stdin `-`):
  { "cols": 80, "rows": 24, "cell_width": 9, "cell_height": 18,
    "steps": [ { "at_ms": 0, "text": "..." }, ... ] }

`text` may embed ANSI escapes as \\e, \\x1b, or \\033. Lone \\n is converted to
\\r\\n (a VT parser needs CRLF; a bare LF staircases the output). Emits the
JSONL recording termctrl's `video`/`show --recording` consume. stdlib only.
"""

import argparse
import json
import sys

ESC = "\x1b"


def expand_escapes(text: str) -> str:
    """Expand \\e/\\x1b/\\033 to ESC, then normalise lone \\n to \\r\\n."""
    text = text.replace("\\e", ESC).replace("\\x1b", ESC).replace("\\033", ESC)
    # collapse any existing CRLF so we do not double carriage returns
    text = text.replace("\r\n", "\n")
    return text.replace("\n", "\r\n")


def build(spec: dict) -> str:
    cols = int(spec.get("cols", 80))
    rows = int(spec.get("rows", 24))
    header = {
        "type": "header",
        "version": 1,
        "cols": cols,
        "rows": rows,
        "cell_width": int(spec.get("cell_width", 9)),
        "cell_height": int(spec.get("cell_height", 18)),
    }
    lines = [json.dumps(header)]
    for i, step in enumerate(spec.get("steps", [])):
        if "text" not in step or "at_ms" not in step:
            raise ValueError(f"step {i} needs both 'at_ms' and 'text'")
        payload = expand_escapes(str(step["text"])).encode("utf-8")
        lines.append(
            json.dumps({"type": "output", "at_ms": int(step["at_ms"]), "bytes": list(payload)})
        )
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a .termctrl recording from a steps file.")
    ap.add_argument("--in", dest="infile", default="-", help="steps JSON file, or - for stdin")
    ap.add_argument("--out", dest="outfile", default="-", help="output .termctrl, or - for stdout")
    args = ap.parse_args()

    if args.infile == "-":
        raw = sys.stdin.read()
    else:
        with open(args.infile, encoding="utf-8") as f:
            raw = f.read()
    try:
        spec = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"error: input is not valid JSON: {e}", file=sys.stderr)
        return 2
    try:
        out = build(spec)
    except (ValueError, TypeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.outfile == "-":
        sys.stdout.write(out)
    else:
        with open(args.outfile, "w", encoding="utf-8") as f:
            f.write(out)
        frames = len(spec.get("steps", []))
        print(f"wrote {args.outfile} ({frames} frames)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
