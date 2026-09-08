"""Path matching and resolution for the `prefix + u` link picker.

The pure half of tmux-fzf-links' path handling: what text on a pane could name
a path, which filesystem locations that text could mean, and what to do with
the one that exists. [`user_schemes.py`](./user_schemes.py) is the adapter that
wires this into the plugin; nothing here imports the plugin, so this file is
typecheckable, testable and runnable on a machine with no plugin checkout.

Three shapes of text produce a row in the picker:

    walkies/target.png              a token - no spaces, the common case
    M  walkies/my image.png         a path with spaces, glued to pane chrome
    src/index.ts:42                 either of those, with a line number

and each is looked for in two places: as written (absolute, `~`-expanded, or
relative to the pane's cwd) and then, only when it is relative, under the
repository root - which is what makes `git diff --name-only` output openable
from a pane sitting in a subdirectory. The pane's cwd always wins.

Everything except `resolve` and `claim` is pure. `resolve` is the one
filesystem probe, and it is memoised so the pre-handler and post-handler of a
scheme cannot disagree about which file a row means; `claim` holds the one row
per file the picker shows.
"""

from __future__ import annotations

import functools
import os
import re
import shlex
from pathlib import Path
from typing import Literal

# A path is at most this long; longer matches are not paths and stat()ing them
# costs an ENAMETOOLONG round trip.
_MAX_PATH_LENGTH = 4096

# Characters no match may contain. Control characters (which include TAB and
# NEWLINE) end a match, as do the shell quotes and the redirection/glob
# metacharacters that surround paths far more often than they appear in one.
# `:` is excluded so the optional `:<line>` suffix can be captured separately.
_FORBIDDEN = r"\\'\"<>|?*:\x00-\x1f"

# A token: the whole match is one path, so spaces end it.
_TOKEN_REGEX = re.compile(rf"(?P<link>[^ {_FORBIDDEN}]{{1,{_MAX_PATH_LENGTH}}})(?::(?P<line>\d+))?")
# A run: spaces are allowed, so the match spans whatever chrome shares the line
# with the path. `_suffixes` finds where the path itself starts inside it.
_RUN_REGEX = re.compile(rf"(?P<link>[^{_FORBIDDEN}]{{1,{_MAX_PATH_LENGTH}}})(?::(?P<line>\d+))?")

# Both are needed and neither subsumes the other: only the run regex can see a
# path with a space in it, and only the token regex can find a path with words
# after it (`see walkies/target.png now`). Every pattern defines `link` and
# `line`, so a caller reads the same two groups whichever one matched.
PATH_REGEXES: tuple[re.Pattern[str], ...] = (_TOKEN_REGEX, _RUN_REGEX)

# What the system opener should be handed rather than an editor. `.svg` is here
# because a preview is what you want from a picker; open one as text by hand.
IMAGE_SUFFIXES: frozenset[str] = frozenset(
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".bmp",
        ".webp",
        ".svg",
        ".ico",
        ".tif",
        ".tiff",
        ".heic",
        ".avif",
    }
)

Kind = Literal["image", "folder", "path"]

_SPACE_RUN = re.compile(r" +")


def _is_pathish(text: str) -> bool:
    """Whether `text` could name something worth offering.

    Drops the strings that match every path regex and name nothing worth
    opening: the empty string, a bare `~`, and anything built only from dots
    and slashes (`.`, `..`, `./`, `/`) - which all resolve to a directory the
    pane is already in or at.
    """
    if not text or text == "~":
        return False
    return not set(text) <= {".", "/"}


def _suffixes(text: str) -> tuple[str, ...]:
    """Where a path could start inside `text`, longest form first.

    A spaceless `text` is one form: itself. A `text` containing spaces might be
    a path that has spaces in it (`walkies/my image.png`) with a prefix of pane
    chrome glued on (`M  walkies/my image.png`, from `git status`), so every
    position after a run of spaces is a place the path could start.

    Only space-containing forms are returned. A spaceless tail is already found
    by the token regex on its own, so offering it here as well would put two
    rows for one file in the picker.

    Trailing chrome is not handled - `wrote walkies/my image.png ok` finds
    nothing. Dropping trailing words too would square the number of probes and
    invent paths out of prose; a leading prefix is the shape that occurs.
    """
    if " " not in text:
        return (text,)
    starts = [0, *(m.end() for m in _SPACE_RUN.finditer(text))]
    return tuple(form for form in (text[start:] for start in starts) if " " in form)


def _roots(form: str, cwd: Path, repo_root: Path | None) -> tuple[Path, ...]:
    """The absolute paths `form` could name, in the order to try them."""
    try:
        expanded = Path(form).expanduser()
    except (RuntimeError, KeyError, OSError, ValueError):
        # An unresolvable `~user`, or a name the platform rejects outright.
        return ()
    if expanded.is_absolute():
        return (expanded,)
    if form.startswith(("./", "../")):
        # Explicitly relative to here, so the repository root is not meant.
        return (cwd / expanded,)
    if repo_root is None or repo_root == cwd:
        return (cwd / expanded,)
    return (cwd / expanded, repo_root / expanded)


def candidates(text: str, *, cwd: Path, repo_root: Path | None) -> tuple[Path, ...]:
    """Every absolute path `text` could name, best first.

    Pure: the caller probes the filesystem, so the ordering this returns is the
    whole of the resolution policy and can be asserted without a temp tree.
    """
    stripped = text.strip()
    if not _is_pathish(stripped):
        return ()
    return tuple(path for form in _suffixes(stripped) for path in _roots(form, cwd, repo_root))


def _exists(path: Path) -> bool:
    try:
        return path.exists()
    except OSError:
        # A name too long for the filesystem is not a path that exists.
        return False


@functools.lru_cache(maxsize=8192)
def resolve(text: str, *, cwd: Path, repo_root: Path | None) -> Path | None:
    """The first candidate for `text` that exists, or None.

    Memoised: a picker run resolves the same match text once per scheme, and a
    scheme's pre-handler and post-handler must agree on the answer even if the
    filesystem changes between building the list and opening a row.

    The result is normalised lexically (`a/../b` -> `b`) for display, but never
    through `Path.resolve()`: a symlinked path is the one that was on screen.
    """
    for candidate in candidates(text, cwd=cwd, repo_root=repo_root):
        if _exists(candidate):
            return Path(os.path.normpath(candidate))
    return None


_claimed: set[tuple[Path, str | None]] = set()


def claim(path: Path, line: str | None) -> bool:
    """Whether this match is the one row `path` gets, mutating what is claimed.

    One file can be on a pane several times and in several forms - written
    absolutely in one line and relatively in another - and every form resolves
    to the same file. The plugin dedupes on the matched *text*, so those would
    be several rows displaying the identical resolved path. First claim wins.

    Keyed on the line number as well, so `src/a.ts:10` and `src/a.ts:42` stay
    two rows: jumping to the line is the point of matching it.
    """
    key = (path, line)
    if key in _claimed:
        return False
    _claimed.add(key)
    return True


def reset_claims() -> None:
    """Forget every claim. For tests; a picker run is one process."""
    _claimed.clear()


def kind_for(path: Path, *, is_dir: bool) -> Kind:
    """Which scheme owns `path` - and therefore how selecting it behaves.

    `is_dir` is passed in rather than probed so this stays pure; the caller has
    already stat'ed the path to know it exists.
    """
    if is_dir:
        return "folder"
    if path.suffix.lower() in IMAGE_SUFFIXES:
        return "image"
    return "path"


def display_for(path: Path, *, cwd: Path, line: str | None = None, home: Path | None = None) -> str:
    """How `path` should read in the picker.

    The resolved path, not the matched text: a row built from a spaced match
    would otherwise show the pane chrome it was glued to, and a repository-root
    match would show a path that does not exist relative to the pane. Shortened
    against the pane's cwd and then the home directory, so the common case is
    the text that was on screen anyway.

    `line` is carried into the text because it is carried into the row's
    identity (see `claim`): compiler output naming one file at ten lines is ten
    rows, and without the number they would be ten rows of identical text.
    """
    if home is None:
        home = Path.home()
    suffix = f":{line}" if line else ""
    if path == home:
        return f"~{suffix}"
    if path != cwd:
        # `relative_to` would answer `.` for the cwd itself, which hides which
        # directory the pane text actually named.
        try:
            return f"{path.relative_to(cwd)}{suffix}"
        except ValueError:
            pass
    try:
        return f"~/{path.relative_to(home)}{suffix}"
    except ValueError:
        return f"{path}{suffix}"


def cd_command(path: Path) -> tuple[str, ...]:
    """The argv that walks the pane's shell into `path`.

    `send-keys` types the string at the shell, so the path has to survive shell
    quoting - a directory whose name contains a quote or a `$` would otherwise
    run as something else entirely.
    """
    return ("tmux", "send-keys", f"cd {shlex.quote(str(path))}", "C-m")


__all__ = [
    "IMAGE_SUFFIXES",
    "PATH_REGEXES",
    "Kind",
    "candidates",
    "cd_command",
    "claim",
    "display_for",
    "kind_for",
    "reset_claims",
    "resolve",
]
