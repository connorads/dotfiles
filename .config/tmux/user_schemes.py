"""Custom schemes for tmux-fzf-links — image file opener."""

import platform
import re

from tmux_fzf_links.export import (
    OpenerType,
    PostHandledMatch,
    PreHandledMatch,
    SchemeEntry,
    heuristic_find_file,
)

_IMAGE_EXTS = r"png|jpe?g|gif|bmp|webp|svg|ico|tiff?"
# A path is one or more `/`-joined segments, optionally rooted at `/`, `~/` or
# `./`. The lookbehind pins the match to a path boundary: without it the engine
# starts mid-path at an interior `/`, so `walkies/.dream-loop/target.png`
# matched as the absolute `/.dream-loop/target.png` — a phantom the opener
# could never resolve, and a duplicate of the real relative path.
_PATH = r"(?:~/|\.{1,2}/|/)?[\w.-]+(?:/[\w.-]+)*"
_IMAGE_RE = re.compile(
    rf"(?<![\w./~-])(?P<path>{_PATH}\.(?:{_IMAGE_EXTS}))(?::(?P<line>\d+))?",
    re.IGNORECASE,
)

_OPEN_CMD = "open" if platform.system() == "Darwin" else "xdg-open"


def _pre(match: re.Match[str]) -> PreHandledMatch | None:
    path = match.group("path")
    # Resolved against the pane's cwd (__main__ chdirs there before matching),
    # so a relative path is honoured and an unresolvable one is dropped — the
    # same existence gate the default file scheme applies.
    if heuristic_find_file(path) is None:
        return None
    return {"display_text": path, "tag": "image"}


def _post(match: re.Match[str]) -> PostHandledMatch:
    resolved = heuristic_find_file(match.group("path"))
    path = str(resolved) if resolved else match.group("path")
    return {"cmd": _OPEN_CMD, "args": [path], "file": path}


image_scheme: SchemeEntry = {
    "tags": ("image",),
    "opener": OpenerType.CUSTOM_OPEN,
    "pre_handler": _pre,
    "post_handler": _post,
    "regex": [_IMAGE_RE],
}

user_schemes: list[SchemeEntry] = [image_scheme]
rm_default_schemes: list[str] = []

__all__ = ["rm_default_schemes", "user_schemes"]
