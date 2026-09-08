"""Tests for the fzf-links path core.

Assertions target the public contract - which text yields which candidates,
which candidate resolves, and what a selected row does - never internal
structure.

Run: cd ~/.config/tmux && uv run --with pytest python -m pytest -q
"""

from __future__ import annotations

import shlex
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

import fzf_link_paths as core


@pytest.fixture(autouse=True)
def _clear_run_state() -> None:
    """Both are per-picker-run state, so a test must not inherit another's."""
    core.resolve.cache_clear()
    core.reset_claims()


# --------------------------------------------------------------------------
# matching: what the regexes offer to the resolver
# --------------------------------------------------------------------------


def links(text: str, regex_index: int) -> list[str]:
    return [m.group("link") for m in core.PATH_REGEXES[regex_index].finditer(text)]


TOKEN, RUN = 0, 1


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        # The regression: the phantom `/.dream-loop/target.png` came from a
        # match that was allowed to start at an interior `/`. A match now
        # starts at the earliest path character, so the relative path is whole.
        ("walkies/.dream-loop/target.png", ["walkies/.dream-loop/target.png"]),
        ("see walkies/target.png now", ["see", "walkies/target.png", "now"]),
        ("~/pics/a.png", ["~/pics/a.png"]),
        ("/abs/a.png", ["/abs/a.png"]),
        # A quoted path needs no pattern of its own: the quotes end a match, so
        # the token inside one is matched on its own.
        ("'my file.png'", ["my", "file.png"]),
    ],
)
def test_token_regex_matches(line: str, expected: list[str]) -> None:
    assert links(line, TOKEN) == expected


def test_token_regex_captures_a_line_number() -> None:
    match = core.PATH_REGEXES[TOKEN].search("src/index.ts:42")
    assert match is not None
    assert (match.group("link"), match.group("line")) == ("src/index.ts", "42")


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        # A tab and a colon both end a run, so `git status` chrome is dropped
        # without the run having to know anything about git.
        ("\tmodified:   walkies/my image.png", ["modified", "   walkies/my image.png"]),
        ("M  walkies/my image.png", ["M  walkies/my image.png"]),
        ("'my file.png'", ["my file.png"]),
    ],
)
def test_run_regex_matches(line: str, expected: list[str]) -> None:
    assert links(line, RUN) == expected


# --------------------------------------------------------------------------
# candidates: the resolution policy, without a filesystem
# --------------------------------------------------------------------------

CWD = Path("/repo/sub")
REPO = Path("/repo")


def test_relative_text_tries_the_pane_cwd_before_the_repo_root() -> None:
    assert core.candidates("src/a.ts", cwd=CWD, repo_root=REPO) == (
        Path("/repo/sub/src/a.ts"),
        Path("/repo/src/a.ts"),
    )


def test_absolute_text_has_exactly_one_candidate() -> None:
    assert core.candidates("/etc/hosts", cwd=CWD, repo_root=REPO) == (Path("/etc/hosts"),)


def test_tilde_expands_to_the_home_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", "/home/someone")
    assert core.candidates("~/pics/a.png", cwd=CWD, repo_root=REPO) == (
        Path("/home/someone/pics/a.png"),
    )


@pytest.mark.parametrize("text", ["./a.ts", "../a.ts"])
def test_an_explicitly_relative_path_never_tries_the_repo_root(text: str) -> None:
    assert core.candidates(text, cwd=CWD, repo_root=REPO) == (CWD / text,)


def test_no_repo_root_leaves_the_cwd_candidate_alone() -> None:
    assert core.candidates("src/a.ts", cwd=CWD, repo_root=None) == (Path("/repo/sub/src/a.ts"),)


def test_a_repo_root_equal_to_the_cwd_is_not_tried_twice() -> None:
    assert core.candidates("src/a.ts", cwd=REPO, repo_root=REPO) == (Path("/repo/src/a.ts"),)


@pytest.mark.parametrize(
    "text",
    ["", "   ", ".", "..", "...", "~", "./", "../", "/", "//", "./."],
)
def test_text_that_names_nothing_yields_no_candidates(text: str) -> None:
    """Every one of these resolves to a directory the pane is already in or
    at, so a row for it would be a row that does nothing."""
    assert core.candidates(text, cwd=CWD, repo_root=REPO) == ()


def test_a_spaced_match_drops_leading_words_longest_form_first() -> None:
    assert core.candidates("M  walkies/my image.png", cwd=CWD, repo_root=None) == (
        Path("/repo/sub/M  walkies/my image.png"),
        Path("/repo/sub/walkies/my image.png"),
    )


def test_a_spaced_match_never_offers_a_spaceless_tail() -> None:
    """The token regex already covers `image.png`; a second row for it would be
    an identical-looking duplicate in the picker."""
    forms = core.candidates("walkies/my image.png", cwd=CWD, repo_root=None)
    assert Path("/repo/sub/image.png") not in forms


def test_a_spaced_match_keeps_interior_spacing_verbatim() -> None:
    """A double space can be chrome or part of the filename, so the walk must
    cut at a space run rather than re-joining split words."""
    forms = core.candidates("wrote  my  image.png", cwd=CWD, repo_root=None)
    assert forms == (
        Path("/repo/sub/wrote  my  image.png"),
        Path("/repo/sub/my  image.png"),
    )


# --------------------------------------------------------------------------
# resolve: the one filesystem probe
# --------------------------------------------------------------------------


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    """A repo with a subdirectory pane cwd, mirroring the live case."""
    (tmp_path / "src").mkdir()
    (tmp_path / "src/index.ts").write_text("export {}\n")
    sub = tmp_path / "sub"
    (sub / "walkies/.dream-loop").mkdir(parents=True)
    (sub / "walkies/.dream-loop/target.png").write_bytes(b"\x89PNG")
    (sub / "walkies/my image.png").write_bytes(b"\x89PNG")
    (sub / "notes").mkdir()
    return tmp_path


def test_resolves_a_relative_path_against_the_pane_cwd(tree: Path) -> None:
    resolved = core.resolve("walkies/.dream-loop/target.png", cwd=tree / "sub", repo_root=tree)
    assert resolved == tree / "sub/walkies/.dream-loop/target.png"


def test_resolves_a_repo_root_relative_path_from_a_subdirectory(tree: Path) -> None:
    assert core.resolve("src/index.ts", cwd=tree / "sub", repo_root=tree) == tree / "src/index.ts"


def test_resolves_a_path_with_spaces(tree: Path) -> None:
    resolved = core.resolve("M  walkies/my image.png", cwd=tree / "sub", repo_root=tree)
    assert resolved == tree / "sub/walkies/my image.png"


def test_a_path_that_does_not_exist_resolves_to_nothing(tree: Path) -> None:
    assert core.resolve("walkies/absent.png", cwd=tree / "sub", repo_root=tree) is None


def test_the_pane_cwd_wins_a_name_that_exists_at_both_roots(tree: Path) -> None:
    (tree / "shared.txt").write_text("repo root\n")
    (tree / "sub/shared.txt").write_text("pane cwd\n")
    resolved = core.resolve("shared.txt", cwd=tree / "sub", repo_root=tree)
    assert resolved is not None
    assert resolved.read_text() == "pane cwd\n"


def test_the_longest_form_wins_when_two_suffixes_both_exist(tree: Path) -> None:
    """`walkies/my image.png` and `my image.png` both exist, and the line said
    the first one."""
    (tree / "sub/my image.png").write_bytes(b"\x89PNG")
    resolved = core.resolve("M  walkies/my image.png", cwd=tree / "sub", repo_root=tree)
    assert resolved == tree / "sub/walkies/my image.png"


def test_a_name_too_long_for_the_filesystem_is_not_a_resolution_error(tree: Path) -> None:
    assert core.resolve("a" * 4096, cwd=tree / "sub", repo_root=tree) is None


def test_a_symlinked_path_stays_the_path_that_was_on_screen(tree: Path) -> None:
    """`Path.resolve()` would report the link's target, which is not the text
    the pane showed and not what an editor should be told to open."""
    (tree / "link").symlink_to(tree / "src")
    assert core.resolve("link/index.ts", cwd=tree, repo_root=tree) == tree / "link/index.ts"


def test_interior_dot_segments_are_normalised_away(tree: Path) -> None:
    assert core.resolve("src/../src/index.ts", cwd=tree, repo_root=tree) == tree / "src/index.ts"


# --------------------------------------------------------------------------
# claim: one row per file
# --------------------------------------------------------------------------


def test_the_first_match_of_a_file_is_the_row_it_gets() -> None:
    assert core.claim(Path("/repo/a.png"), None) is True
    assert core.claim(Path("/repo/a.png"), None) is False


def test_two_line_numbers_in_one_file_stay_two_rows() -> None:
    assert core.claim(Path("/repo/a.ts"), "10") is True
    assert core.claim(Path("/repo/a.ts"), "42") is True
    assert core.claim(Path("/repo/a.ts"), "42") is False


def test_two_files_do_not_collide() -> None:
    assert core.claim(Path("/repo/a.png"), None) is True
    assert core.claim(Path("/repo/b.png"), None) is True


# --------------------------------------------------------------------------
# kind: which scheme, and therefore which application, owns a row
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("a.png", "image"),
        ("a.PNG", "image"),
        ("a.jpeg", "image"),
        ("a.svg", "image"),
        ("a.heic", "image"),
        ("index.ts", "path"),
        ("archive.zip", "path"),
        ("README", "path"),
    ],
)
def test_kind_of_a_file(name: str, expected: core.Kind) -> None:
    assert core.kind_for(Path("/x") / name, is_dir=False) == expected


def test_a_directory_is_a_folder_whatever_its_name_ends_in() -> None:
    assert core.kind_for(Path("/x/assets.png"), is_dir=True) == "folder"


# --------------------------------------------------------------------------
# display and dispatch
# --------------------------------------------------------------------------


def test_a_path_under_the_pane_cwd_displays_relative_to_it() -> None:
    assert core.display_for(Path("/repo/sub/a.png"), cwd=CWD, home=Path("/home/me")) == "a.png"


def test_a_repo_root_match_displays_a_path_that_names_the_real_file() -> None:
    assert (
        core.display_for(Path("/repo/src/a.ts"), cwd=CWD, home=Path("/home/me")) == "/repo/src/a.ts"
    )


def test_a_path_under_home_displays_shortened() -> None:
    assert (
        core.display_for(Path("/home/me/pics/a.png"), cwd=CWD, home=Path("/home/me"))
        == "~/pics/a.png"
    )


def test_the_pane_cwd_itself_displays_as_the_directory_it_names() -> None:
    """A `.` here would hide which directory the pane text named."""
    assert core.display_for(CWD, cwd=CWD, home=Path("/home/me")) == "/repo/sub"


def test_the_home_directory_displays_as_a_tilde() -> None:
    assert core.display_for(Path("/home/me"), cwd=CWD, home=Path("/home/me")) == "~"


def test_a_line_number_is_part_of_the_row_text() -> None:
    """It is part of the row's identity, so ten lines of one file must not read
    as ten copies of the same row."""
    assert (
        core.display_for(Path("/repo/sub/a.ts"), cwd=CWD, line="42", home=Path("/home/me"))
        == "a.ts:42"
    )


def test_cd_walks_the_shell_into_the_directory() -> None:
    cmd = core.cd_command(Path("/repo/sub/notes"))
    assert cmd == ("tmux", "send-keys", "cd /repo/sub/notes", "C-m")


def test_cd_survives_a_directory_name_the_shell_would_otherwise_eat() -> None:
    """A quote, a space or a `$` in a directory name is a shell injection in
    the `send-keys` path, not a display problem."""
    for name in ("it's here", "two words", "$HOME(x)"):
        cmd = core.cd_command(Path("/repo") / name)
        assert shlex.split(cmd[2]) == ["cd", f"/repo/{name}"]
