#!/usr/bin/env python3
# render-dump.py: replay a recorded tmux client tty stream (from `script`) into
# a pyte terminal emulator and print the final composited screen, one row per
# line. This is how tests and sign-offs see what a client actually *rendered*
# (status rows, borders, floats composited over tiled panes) rather than what
# panes contain.
#
# Usage: uv run --with pyte render-dump.py <logfile> [WxH]
#   WxH must match the client size the log was recorded at (pyte does not
#   parse resize escapes); default 80x24, the bats/`script` pty default.
#
# Stock pyte raises on tmux's private DSR query (CSI ?996n, colour-scheme
# report) because Screen.report_device_status asserts on known modes only;
# no-op the report hooks so the replay survives real tmux output.
import sys

import pyte


class TolerantScreen(pyte.Screen):
    def report_device_status(self, *args, **kwargs):
        pass

    def report_device_attributes(self, *args, **kwargs):
        pass


def main() -> int:
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print(__doc__ or "usage: render-dump.py <logfile> [WxH]", file=sys.stderr)
        return 2
    logfile = sys.argv[1]
    width, height = 80, 24
    if len(sys.argv) == 3:
        try:
            w, h = sys.argv[2].lower().split("x", 1)
            width, height = int(w), int(h)
        except ValueError:
            print(f"invalid size {sys.argv[2]!r}, expected WxH", file=sys.stderr)
            return 2
    screen = TolerantScreen(width, height)
    stream = pyte.ByteStream(screen)
    with open(logfile, "rb") as f:
        stream.feed(f.read())
    for line in screen.display:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
