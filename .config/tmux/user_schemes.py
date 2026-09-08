"""Path schemes for tmux-fzf-links: images, folders, and everything else.

The adapter, and the only file here that touches the plugin. It takes the
`file` and `dir` tags away from the plugin's default file scheme (see
`rm_default_schemes` at the bottom) and gives each kind of path its own scheme,
so each can carry its own opener - an image goes to Preview, a folder `cd`s the
pane, and anything else goes to $EDITOR with upstream's binary-file refusal
intact. One scheme with three tags could not do that: `opener` is per scheme.

All the matching, resolution and dispatch logic lives in the plugin-free core
next door, [`fzf_link_paths.py`](./fzf_link_paths.py), which is where the tests
and the type gate are. This file holds the wiring and no branches.

Note `rm_default_schemes` is checked against user schemes too, so a scheme here
must not claim `file` or `dir` - it would remove itself. Fresh tag names plus
the removal is what makes ours the only path handling that runs.
"""

from __future__ import annotations

import functools
import importlib.util
import os
import re
import subprocess
from collections.abc import Callable
from pathlib import Path

from tmux_fzf_links.export import (
    OpenerType,
    PostHandledMatch,
    PreHandledMatch,
    SchemeEntry,
    colors,
)

_CORE_PATH = Path(__file__).resolve().parent / "fzf_link_paths.py"

# Loaded by path rather than by name: the plugin imports this file through its
# own spec loader, so `~/.config/tmux` is not on the import path and never
# should be - a name that generic would shadow whatever else is installed.
_spec = importlib.util.spec_from_file_location("fzf_link_paths", _CORE_PATH)
if _spec is None or _spec.loader is None:
    raise ImportError(f"cannot load the path core at {_CORE_PATH}")
core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(core)


# Both of these are resolved lazily, and that ordering is load-bearing: the
# plugin imports this module ~45 lines before it chdirs to the pane's cwd, so
# anything eager here would answer for the wrong directory.
@functools.cache
def _cwd() -> Path:
    return Path.cwd()


@functools.cache
def _repo_root() -> Path | None:
    """The pane's repository root, so repo-relative paths resolve.

    `GIT_DIR`/`GIT_WORK_TREE` are stripped because the dotfiles hook wrappers
    export them: inheriting those would report this repository's root from
    every pane, whatever the pane is actually in.
    """
    env = {k: v for k, v in os.environ.items() if k not in ("GIT_DIR", "GIT_WORK_TREE")}
    try:
        result = subprocess.run(
            ("git", "-C", str(_cwd()), "rev-parse", "--show-toplevel"),
            capture_output=True,
            text=True,
            env=env,
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    root = result.stdout.strip()
    if result.returncode != 0 or not root:
        return None
    return Path(root)


def _resolved(match: re.Match[str]) -> Path | None:
    return core.resolve(match.group("link"), cwd=_cwd(), repo_root=_repo_root())


def _target(match: re.Match[str]) -> Path:
    """The path a selected row means, for the post handlers.

    The core memoises resolution, so this is the same answer the pre-handler
    gave when it put the row in the list.
    """
    path = _resolved(match)
    if path is None:
        raise RuntimeError(f"could not resolve the path of: {match.group('link')}")
    return path


def _open_post_handler(match: re.Match[str]) -> PostHandledMatch:
    return {"file": str(_target(match))}


def _cd_post_handler(match: re.Match[str]) -> PostHandledMatch:
    path = _target(match)
    cmd = core.cd_command(path)
    return {"cmd": cmd[0], "args": list(cmd[1:]), "file": str(path)}


def _edit_post_handler(match: re.Match[str]) -> PostHandledMatch:
    # `line` is upstream's `%line` template placeholder; the first line is the
    # default for a match that carried no `:<n>` suffix.
    return {"file": str(_target(match)), "line": match.group("line") or "1"}


def _scheme(
    kind: str,
    opener: OpenerType,
    post_handler: Callable[[re.Match[str]], PostHandledMatch],
) -> SchemeEntry:
    """One scheme claiming exactly the matches whose resolved kind is `kind`.

    Each of the three declines what is not its own, so exactly one scheme takes
    each match and the picker never shows the same file twice. The cost is that
    the pane content is scanned once per scheme.
    """

    def pre_handler(match: re.Match[str]) -> PreHandledMatch | None:
        path = _resolved(match)
        if path is None or core.kind_for(path, is_dir=path.is_dir()) != kind:
            return None
        line = match.group("line")
        display_text = core.display_for(path, cwd=_cwd(), line=line, repo_root=_repo_root())
        if colors.enabled:
            display_text = f"\033[{colors.get_file_color(path)}m{display_text}\033[0m"
        # Claimed after the kind check, so a scheme only ever claims its own,
        # and after the text is final, so the budget counts what the popup
        # command will really carry - see `claim` for what overruns it.
        overhead = core.ROW_OVERHEAD_COLOURED if colors.enabled else core.ROW_OVERHEAD_PLAIN
        if not core.claim(path, line, len(display_text.encode()) + overhead):
            return None
        return {"display_text": display_text, "tag": kind}

    return {
        "tags": (kind,),
        "opener": opener,
        "pre_handler": pre_handler,
        "post_handler": post_handler,
        "regex": list(core.PATH_REGEXES),
    }


user_schemes: list[SchemeEntry] = [
    # SYSTEM_OPEN is Preview / xdg-open / explorer, chosen by the plugin from
    # `sys.platform`, so there is no platform branch to keep here.
    _scheme("image", OpenerType.SYSTEM_OPEN, _open_post_handler),
    _scheme("folder", OpenerType.CUSTOM_OPEN, _cd_post_handler),
    # EDITOR brings upstream's `%file`/`%line` templating and, with it, its
    # refusal to open a binary in the editor - which the default file scheme's
    # CUSTOM_OPEN skipped, so a picked `.zip` really did open in nvim.
    _scheme("path", OpenerType.EDITOR, _edit_post_handler),
]

# Both tags of the default file scheme, so it drops out entirely and ours is
# the only path handling that runs. Deleting this line and `user_schemes`
# restores the plugin's own behaviour.
rm_default_schemes: list[str] = ["file", "dir"]

__all__ = ["rm_default_schemes", "user_schemes"]
