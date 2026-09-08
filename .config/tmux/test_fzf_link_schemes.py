"""Integration test for the fzf-links user schemes.

Drives the real plugin: it merges `user_schemes` with `default_schemes` exactly
as `tmux_fzf_links/__main__.py` does, then runs the merged schemes over pane
content in a temp tree. That is the only way to assert the two things the
adapter exists for - that the default file scheme is gone, and that each kind
of path is claimed by exactly one of ours.

Skipped when the plugin checkout is absent (it is gitignored, so CI has none).

Run: cd ~/.config/tmux && uv run --with pytest python -m pytest -q
"""

from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

HERE = Path(__file__).resolve().parent
PLUGIN_PKG = HERE / "plugins/tmux-fzf-links/tmux-fzf-links-python-pkg"

# Safe when the checkout is absent: every plugin import below is inside a test
# or fixture, so collection does not need it.
sys.path.insert(0, str(PLUGIN_PKG))

pytestmark = pytest.mark.skipif(
    not (PLUGIN_PKG / "tmux_fzf_links").is_dir(),
    reason=f"tmux-fzf-links checkout absent at {PLUGIN_PKG}",
)


def _load_adapter() -> ModuleType:
    """Load user_schemes.py the way the plugin does - by path, freshly.

    Freshly matters: the adapter memoises the pane cwd and repository root on
    first use, so a module reused across tests would answer for another test's
    temp tree.
    """
    spec = importlib.util.spec_from_file_location("user_schemes_module", HERE / "user_schemes.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _merge(user_schemes: list[Any], default_schemes: list[Any], removed: list[str]) -> list[Any]:
    """The merge from `__main__.py`, verbatim in behaviour.

    Note `checked` is never added to upstream, so it drops out here: a user
    scheme does *not* take precedence over a default one by claiming its tag.
    `rm_default_schemes` is the mechanism that works, and it is checked against
    user schemes too - which is why ours claim fresh tags.
    """
    schemes: list[Any] = []
    for scheme in user_schemes + default_schemes:
        if all(tag not in removed for tag in scheme["tags"]):
            schemes.append(scheme)
    return schemes


def _rows(content: str, schemes: list[Any], adapter: ModuleType) -> list[tuple[str, str]]:
    """Every (tag, display text) the picker would list, deduped as upstream is.

    Claims are one-shot per process, so they are reset first: a pre-handler
    pass is the thing being measured, and a previous pass would have taken
    every row already.
    """
    adapter.core.reset_claims()
    seen: set[str] = set()
    rows: list[tuple[str, str]] = []
    for scheme in schemes:
        for regex in scheme["regex"]:
            for match in regex.finditer(content):
                pre = scheme["pre_handler"](match) if scheme["pre_handler"] else None
                if pre is None or match.group(0) in seen:
                    continue
                seen.add(match.group(0))
                rows.append((pre["tag"], pre["display_text"]))
    return rows


def _match_for(
    content: str, schemes: list[Any], adapter: ModuleType, tag: str, display: str
) -> tuple[Any, re.Match[str]]:
    """The scheme and match object behind one row, for the post-handler tests."""
    adapter.core.reset_claims()
    for scheme in schemes:
        for regex in scheme["regex"]:
            for match in regex.finditer(content):
                pre = scheme["pre_handler"](match) if scheme["pre_handler"] else None
                if pre is not None and (pre["tag"], pre["display_text"]) == (tag, display):
                    return scheme, match
    raise AssertionError(f"no [{tag}] row displaying {display!r}")


@pytest.fixture
def tree(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A git repo whose pane cwd is a subdirectory, as in the live failure."""
    monkeypatch.delenv("GIT_DIR", raising=False)
    monkeypatch.delenv("GIT_WORK_TREE", raising=False)
    (tmp_path / "src").mkdir()
    (tmp_path / "src/index.ts").write_text("export {}\n")
    (tmp_path / "archive.zip").write_bytes(b"PK\x03\x04\x00\x00")
    sub = tmp_path / "sub"
    (sub / "walkies/.dream-loop").mkdir(parents=True)
    (sub / "walkies/.dream-loop/target.png").write_bytes(b"\x89PNG")
    (sub / "walkies/my image.png").write_bytes(b"\x89PNG")
    (sub / "notes").mkdir()
    subprocess.run(("git", "init", "-q"), cwd=tmp_path, check=True)
    monkeypatch.chdir(sub)
    return tmp_path


@pytest.fixture
def adapter(tree: Path) -> ModuleType:
    """Loaded after `tree` has chdir'd, since the adapter reads the cwd once."""
    return _load_adapter()


@pytest.fixture
def merged(adapter: ModuleType) -> list[Any]:
    from tmux_fzf_links.configs import configs
    from tmux_fzf_links.default_schemes import default_schemes

    # The default file scheme drops every match longer than this, and the
    # singleton is only initialised from the real entry point. Set it so the
    # test would still see default-scheme rows if the removal stopped working.
    configs.max_path_length = 4096

    return _merge(adapter.user_schemes, default_schemes, adapter.rm_default_schemes)


def _tag_to_index(schemes: list[Any]) -> dict[str, int]:
    return {tag: i for i, scheme in enumerate(schemes) for tag in scheme["tags"]}


def test_the_default_file_scheme_is_gone(merged: list[Any]) -> None:
    tags = _tag_to_index(merged)
    assert "file" not in tags
    assert "dir" not in tags


def test_the_path_tags_are_all_owned_by_our_schemes(merged: list[Any]) -> None:
    adapter_tags = {"image", "folder", "path"}
    owners = {
        tag: merged[index] for tag, index in _tag_to_index(merged).items() if tag in adapter_tags
    }
    assert set(owners) == adapter_tags
    assert all(
        scheme["pre_handler"].__qualname__.startswith("_scheme") for scheme in owners.values()
    )


def test_the_other_default_schemes_survive(merged: list[Any]) -> None:
    tags = _tag_to_index(merged)
    for tag in ("url", "git", "link", "PR", "code err."):
        assert tag in tags


CONTENT = """\
walkies/.dream-loop/target.png
M  walkies/my image.png
src/index.ts:42
archive.zip
notes
"""


def test_every_kind_of_path_gets_exactly_one_row(
    merged: list[Any], adapter: ModuleType, tree: Path
) -> None:
    assert sorted(_rows(CONTENT, merged, adapter)) == sorted(
        [
            # A relative image: one row, tagged image - not the phantom
            # `/.dream-loop/target.png` plus a [file] duplicate.
            ("image", "walkies/.dream-loop/target.png"),
            # A path with spaces, which the token regexes cannot see at all.
            ("image", "walkies/my image.png"),
            # Repo-root-relative, resolved from a subdirectory pane, and shown
            # in git's own repo-relative spelling rather than as a long
            # absolute path - every row byte goes into the popup command.
            ("path", ":/src/index.ts:42"),
            ("path", ":/archive.zip"),
            ("folder", "notes"),
        ]
    )


def test_one_file_matched_twice_gets_one_row(
    merged: list[Any], adapter: ModuleType, tree: Path
) -> None:
    """The plugin dedupes on the matched text, so the same file written both
    absolutely and relatively would otherwise be two identical-looking rows."""
    content = f"walkies/my image.png\n{tree}/sub/walkies/my image.png\n"
    assert _rows(content, merged, adapter) == [("image", "walkies/my image.png")]


def test_an_image_is_handed_to_the_system_opener(
    merged: list[Any], adapter: ModuleType, tree: Path
) -> None:
    scheme, match = _match_for(CONTENT, merged, adapter, "image", "walkies/my image.png")
    from tmux_fzf_links.opener import OpenerType

    assert scheme["opener"] == OpenerType.SYSTEM_OPEN
    assert scheme["post_handler"](match) == {"file": f"{tree}/sub/walkies/my image.png"}


def test_a_source_file_is_handed_to_the_editor_with_its_line(
    merged: list[Any], adapter: ModuleType, tree: Path
) -> None:
    scheme, match = _match_for(CONTENT, merged, adapter, "path", ":/src/index.ts:42")
    from tmux_fzf_links.opener import OpenerType

    assert scheme["opener"] == OpenerType.EDITOR
    assert scheme["post_handler"](match) == {"file": f"{tree}/src/index.ts", "line": "42"}


def test_a_binary_is_refused_by_the_editor_rather_than_opened_in_it(
    merged: list[Any], adapter: ModuleType, tree: Path
) -> None:
    """The default file scheme hand-rolled its editor templating under
    CUSTOM_OPEN, so upstream's binary check never ran and a picked `.zip`
    really did open in nvim."""
    scheme, match = _match_for(CONTENT, merged, adapter, "path", ":/archive.zip")
    from tmux_fzf_links.errors_types import BinaryFileSelected
    from tmux_fzf_links.opener import open_link

    with pytest.raises(BinaryFileSelected, match="binary"):
        open_link(scheme["post_handler"](match), "nvim +%line '%file'", "", scheme["opener"])


def test_a_folder_walks_the_pane_shell_into_it(
    merged: list[Any], adapter: ModuleType, tree: Path
) -> None:
    scheme, match = _match_for(CONTENT, merged, adapter, "folder", "notes")
    assert scheme["post_handler"](match) == {
        "cmd": "tmux",
        "args": ["send-keys", f"cd {tree}/sub/notes", "C-m"],
        "file": f"{tree}/sub/notes",
    }


# --------------------------------------------------------------------------
# the wedge: a popup command tmux refuses hangs the plugin forever
# --------------------------------------------------------------------------

# tmux refuses any command over MAX_IMSGSIZE with `command too long`. Measured
# on 3.7b: 16000 bytes goes through, 17000 does not.
TMUX_COMMAND_LIMIT = 16384


def _colors() -> Any:
    """Imported lazily like every other plugin symbol here, so collection works
    with no checkout."""
    from tmux_fzf_links.colors import colors

    return colors


def _popup_command_length(rows: list[tuple[str, str]]) -> int:
    """How long the command `run_fzf` hands to `tmux popup -E` would be.

    Mirrors `fzf_handler.run_fzf` and `__main__.run`: every row, with its
    numbered and coloured prefix, is embedded in a single tmux command. A
    change to either shape here is a change to the budget's arithmetic.
    """
    colors = _colors()
    width = max((len(tag) for tag, _ in rows), default=0)
    numbered = [
        f"{colors.index_color}{idx:4d}{colors.reset_color} "
        f"{colors.dash_color}-{colors.reset_color} "
        f"{colors.tag_color}{('[' + tag + ']').ljust(width + 2)}{colors.reset_color} "
        f"{colors.dash_color}-{colors.reset_color} {text}"
        for idx, (tag, text) in enumerate(rows, 1)
    ]
    scaffolding = 600  # `tmux popup -E`, geometry, fzf args, header, FIFO paths
    return scaffolding + len("\n".join(numbered))


@pytest.fixture
def dense(tree: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    """A pane full of paths - the shape that wedged tmux on a codex pane."""
    listing = tree / "many"
    listing.mkdir()
    for i in range(500):
        (listing / f"module-with-a-realistic-name-{i:03d}.ts").write_text("x\n")
    monkeypatch.setattr(_colors(), "enabled", True)
    return "\n".join(f"many/{p.name}" for p in sorted(listing.iterdir())) + "\n"


def test_a_pane_full_of_paths_cannot_wedge_tmux(
    merged: list[Any], adapter: ModuleType, dense: str
) -> None:
    """500 paths on screen used to build a ~40KB command; tmux refuses it,
    `run_fzf` then blocks forever on a FIFO nothing writes, and the foreground
    `run-shell` binding queues every key - a terminal you have to kill."""
    rows = _rows(dense, merged, adapter)
    assert _popup_command_length(rows) < TMUX_COMMAND_LIMIT


def test_the_budget_is_what_stops_it_and_it_does_drop_rows(
    merged: list[Any], adapter: ModuleType, dense: str
) -> None:
    """Named so the trade is explicit: past the budget a path on screen gets no
    row. That is the price of the picker opening at all."""
    rows = _rows(dense, merged, adapter)
    assert 0 < len(rows) < 500
