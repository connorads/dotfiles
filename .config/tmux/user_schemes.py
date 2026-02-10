"""Custom schemes for tmux-fzf-links — image file opener."""

import platform
import re

from tmux_fzf_links.export import (
    OpenerType,
    PostHandledMatch,
    PreHandledMatch,
    SchemeEntry,
)

_IMAGE_EXTS = r"png|jpe?g|gif|bmp|webp|svg|ico|tiff?"
_IMAGE_RE = re.compile(
    rf"(?P<path>(?:[~/.][\w./-]*)?[\w.-]+\.(?:{_IMAGE_EXTS}))(?::(?P<line>\d+))?",
    re.IGNORECASE,
)

_OPEN_CMD = "open" if platform.system() == "Darwin" else "xdg-open"


def _pre(match: re.Match[str]) -> PreHandledMatch | None:
    return {"display_text": match.group("path"), "tag": "image"}


def _post(match: re.Match[str]) -> PostHandledMatch:
    return {"cmd": _OPEN_CMD, "args": [match.group("path")], "file": match.group("path")}


image_scheme: SchemeEntry = {
    "tags": ("image",),
    "opener": OpenerType.CUSTOM_OPEN,
    "pre_handler": _pre,
    "post_handler": _post,
    "regex": [_IMAGE_RE],
}

user_schemes: list[SchemeEntry] = [image_scheme]
rm_default_schemes: list[str] = []

__all__ = ["user_schemes", "rm_default_schemes"]
