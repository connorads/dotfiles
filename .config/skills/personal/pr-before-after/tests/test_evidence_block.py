import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPT = SKILL_DIR / "scripts" / "evidence-block.py"


def load_module():
    spec = importlib.util.spec_from_file_location("evidence_block", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


eb = load_module()
OPEN, CLOSE = eb.OPEN_MARK, eb.CLOSE_MARK
URL_A = "https://github.com/user-attachments/assets/00000000-0000-4000-8000-00000000000a"
URL_B = "https://github.com/user-attachments/assets/00000000-0000-4000-8000-00000000000b"


def touch(root: Path, *names: str) -> None:
    for name in names:
        p = root / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"fixture")


def cli(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], cwd=cwd, capture_output=True, text=True
    )


def ok(cwd: Path, *args: str) -> str:
    r = cli(cwd, *args)
    assert r.returncode == 0, r.stderr
    return r.stdout


def fails(cwd: Path, *args: str) -> str:
    r = cli(cwd, *args)
    assert r.returncode == 1, (r.returncode, r.stdout, r.stderr)
    assert r.stdout == ""
    assert r.stderr.startswith("error:"), r.stderr
    return r.stderr


SHELF = f"{OPEN}\nstale screenshots from last week\n{CLOSE}"
BLOCK = [OPEN, "| New |", "| --- |", "| ![New](./a.png) |", "", CLOSE]
TEXT = "\n".join(BLOCK) + "\n"


# --- files ------------------------------------------------------------------


@pytest.mark.parametrize("name", ["a.png", "a.JPG", "a.Jpeg", "a.gif", "a.WEBP"])
def test_files_renders_image_suffixes_as_a_markdown_table(tmp_path, name):
    touch(tmp_path, name)
    assert f"| ![New](./{name}) |" in ok(tmp_path, "files", "--new", name)


@pytest.mark.parametrize("name", ["a.mp4", "a.MOV", "a.WebM"])
def test_files_renders_video_suffixes_as_stacked_clips(tmp_path, name):
    touch(tmp_path, name)
    assert f"New:\n\n![New](./{name})\n" in ok(tmp_path, "files", "--new", name)


def test_files_names_an_svg_it_cannot_embed(tmp_path):
    touch(tmp_path, "logo.svg")
    assert "logo.svg" in fails(tmp_path, "files", "--new", "logo.svg")


def test_files_prints_paths_dot_relative_to_cwd(tmp_path):
    touch(tmp_path, "shots/home.png")
    for arg in (str(tmp_path / "shots/home.png"), "shots/home.png"):
        assert "](./shots/home.png)" in ok(tmp_path, "files", "--new", arg)


def test_files_rejects_a_path_containing_a_space(tmp_path):
    touch(tmp_path, "my shots/after.png")
    assert "whitespace" in fails(tmp_path, "files", "--new", "my shots/after.png")


def test_files_rejects_a_capture_above_cwd(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    touch(tmp_path, "elsewhere.png")
    for arg in (str(tmp_path / "elsewhere.png"), "../elsewhere.png"):
        assert "move it under" in fails(repo, "files", "--new", arg)


def test_files_names_a_missing_capture(tmp_path):
    assert "shots/missing.png" in fails(tmp_path, "files", "--new", "shots/missing.png")


def test_files_caption_labels_the_preceding_row(tmp_path):
    touch(tmp_path, "b1.png", "a1.png", "a2.png")
    out = ok(
        tmp_path,
        "files",
        "--pair",
        "b1.png",
        "a1.png",
        "--caption",
        "Desktop",
        "--new",
        "a2.png",
    )
    assert out == (
        f"{OPEN}\n"
        "**Desktop**\n\n"
        "| Before | After |\n| --- | --- |\n| ![Before](./b1.png) | ![After](./a1.png) |\n\n"
        "| New |\n| --- |\n| ![New](./a2.png) |\n\n"
        f"{CLOSE}\n"
    )


def test_files_caption_before_any_row_fails(tmp_path):
    touch(tmp_path, "a.png")
    assert "--pair or --new first" in fails(tmp_path, "files", "--caption", "X", "--new", "a.png")


def test_files_second_caption_on_a_row_fails(tmp_path):
    touch(tmp_path, "a.png")
    err = fails(tmp_path, "files", "--new", "a.png", "--caption", "X", "--caption", "Y")
    assert "row 1" in err


def test_files_without_rows_fails(tmp_path):
    assert "no rows" in fails(tmp_path, "files")


@pytest.mark.parametrize(
    "text", ["A|B", "<b>", "R&D", "two\nlines", " ", "", "](./evil.png)", "*bold*", "`x`", "a_b"]
)
def test_files_rejects_a_caption_with_markup_characters(tmp_path, text):
    touch(tmp_path, "a.png")
    assert "caption" in fails(tmp_path, "files", "--new", "a.png", "--caption", text)


def test_files_keeps_a_non_ascii_caption(tmp_path):
    touch(tmp_path, "a.png")
    assert "**Écran 日本語 📱**" in ok(
        tmp_path, "files", "--new", "a.png", "--caption", "Écran 日本語 📱"
    )


def test_files_by_line_is_last_inside_the_block(tmp_path):
    touch(tmp_path, "a.png")
    lines = ok(tmp_path, "files", "--new", "a.png", "--by", "Sam Example").splitlines()
    assert lines[-3:] == ["_Captured by Sam Example_", "", CLOSE]


def test_files_rejects_a_by_name_with_markup(tmp_path):
    touch(tmp_path, "a.png")
    assert "--by" in fails(tmp_path, "files", "--new", "a.png", "--by", "<img src=x>")


def test_files_rejects_a_video_paired_with_an_image(tmp_path):
    touch(tmp_path, "old.mov", "new.jpg")
    assert "row 1" in fails(tmp_path, "files", "--pair", "old.mov", "new.jpg")


def test_files_video_pair_stacks_before_above_after(tmp_path):
    touch(tmp_path, "old-flow.mov", "new-flow.mp4")
    lines = ok(tmp_path, "files", "--pair", "old-flow.mov", "new-flow.mp4").splitlines()
    assert lines == [
        OPEN,
        "Before:",
        "",
        "![Before](./old-flow.mov)",
        "",
        "After:",
        "",
        "![After](./new-flow.mp4)",
        "",
        CLOSE,
    ]


def test_files_mixes_image_and_video_rows(tmp_path):
    touch(tmp_path, "b.png", "a.png", "flow.webm")
    out = ok(tmp_path, "files", "--pair", "b.png", "a.png", "--new", "flow.webm")
    assert "| ![Before](./b.png) | ![After](./a.png) |" in out
    assert "New:\n\n![New](./flow.webm)\n" in out


# --- hosted -----------------------------------------------------------------


def test_hosted_pair_renders_two_video_cells_in_order(tmp_path):
    out = ok(tmp_path, "hosted", "--pair", URL_B, URL_A, "--caption", "Flow")
    assert "**Flow**" in out
    assert "<tr><th>Before</th><th>After</th></tr>" in out
    assert f'<td><video controls src="{URL_B}"></video></td>' in out
    assert out.count("<video ") == 2
    assert out.index(URL_B) < out.index(URL_A)


def test_hosted_new_renders_one_column(tmp_path):
    out = ok(tmp_path, "hosted", "--new", URL_A)
    assert "<tr><th>New</th></tr>" in out
    assert "Before" not in out


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/clip.mp4",
        "http://github.com/user-attachments/assets/x",
        "https://github.com.evil.test/user-attachments/assets/x",
        "https://github.com/owner/repo/assets/x",
    ],
)
def test_hosted_accepts_only_github_user_attachment_urls(tmp_path, url):
    assert "user-attachments" in fails(tmp_path, "hosted", "--new", url)


# --- uploads ----------------------------------------------------------------


def test_uploads_drops_repeated_paths(tmp_path):
    touch(tmp_path, "old-home.png", "new-home.png", "signup.mp4")
    out = ok(
        tmp_path,
        "uploads",
        "--pair",
        "old-home.png",
        "new-home.png",
        "--new",
        "signup.mp4",
        "--pair",
        "old-home.png",
        "new-home.png",
        "--caption",
        "Repeat",
        "--pair",
        "signup.mp4",
        "signup.mp4",
    )
    assert out == "./old-home.png\n./new-home.png\n./signup.mp4\n"


# --- --body splice ----------------------------------------------------------


def test_missing_markers_place_block_at_end_after_one_blank_line():
    for body in ("Summary of the PR\n", "Summary of the PR", "Summary of the PR\n\n"):
        assert eb.splice(body, BLOCK) == "Summary of the PR\n\n" + TEXT


def test_blank_body_becomes_the_block_alone():
    assert eb.splice("", BLOCK) == TEXT
    assert eb.splice("  \n\n", BLOCK) == TEXT


def test_lines_outside_markers_are_copied_verbatim():
    body = f"Why  this\n\n\n\n{SHELF}\n\n\n  Closes the ticket\n\n"
    assert eb.splice(body, BLOCK) == f"Why  this\n\n\n\n{TEXT}\n\n  Closes the ticket\n\n"


def test_markers_on_the_first_line():
    assert eb.splice(f"{SHELF}\nTesting notes\n", BLOCK) == f"{TEXT}Testing notes\n"


def test_crlf_body_gets_a_crlf_block():
    body = f"Why\r\n\r\n{OPEN}\r\nold\r\n{CLOSE}\r\n\r\n## Notes\r\nkeep\r\n"
    out = eb.splice(body, BLOCK)
    assert out.startswith("Why\r\n\r\n")
    assert out.endswith("\r\n\r\n## Notes\r\nkeep\r\n")
    assert "\n" not in out.replace("\r\n", "")


def test_indented_code_below_and_trailing_spaces_above_are_untouched():
    body = f"why  \n\n{SHELF}\n    code1\n    code2\n"
    out = eb.splice(body, BLOCK)
    assert out == f"why  \n\n{TEXT}    code1\n    code2\n"


def test_marker_text_inside_a_line_is_ignored():
    body = f"The helper writes `{OPEN}` here.\n"
    assert eb.splice(body, BLOCK) == body + "\n" + TEXT


@pytest.mark.parametrize(
    "body",
    [
        "",
        "Why\n",
        "Why\r\nMore\r\n",
        f"Why\n{SHELF}\nCloses the ticket",
        SHELF,
        "a\n\n\n",
    ],
)
def test_second_splice_changes_nothing(body):
    once = eb.splice(body, BLOCK)
    assert eb.splice(once, BLOCK) == once


@pytest.mark.parametrize(
    "body",
    [
        f"{SHELF}\n{CLOSE}\n",
        f"{OPEN}\n{OPEN}\nduplicate opener\n{CLOSE}\n",
        f"Why\n{CLOSE}\n",
        f"{SHELF}\n\n{SHELF}\n",
        f"Why\n{OPEN}\nno close\n",
    ],
)
def test_unbalanced_markers_fail(body):
    with pytest.raises(eb.EvidenceError, match="leave one of each"):
        eb.splice(body, BLOCK)


def test_close_marker_above_open_fails():
    with pytest.raises(eb.EvidenceError, match="swap them"):
        eb.splice(f"{CLOSE}\nx\n{OPEN}\n", BLOCK)


def test_files_body_prints_whole_body_and_reruns_stable(tmp_path):
    touch(tmp_path, "shots/b.png", "shots/a.png")
    (tmp_path / "body.md").write_text(f"Why\n\n{SHELF}\n\n## Changes\n- x\n")
    args = ["files", "--pair", "shots/b.png", "shots/a.png", "--caption", "Desktop"]
    out = ok(tmp_path, *args, "--body", "body.md")
    assert out.startswith(f"Why\n\n{OPEN}\n**Desktop**\n")
    assert out.endswith(f"{CLOSE}\n\n## Changes\n- x\n")
    assert "stale screenshots" not in out
    (tmp_path / "body.md").write_text(out)
    assert ok(tmp_path, *args, "--body", "body.md") == out


def test_hosted_body_replaces_the_marked_block(tmp_path):
    (tmp_path / "body.md").write_text(f"Why\n\n{SHELF}\n\nCloses the ticket\n")
    out = ok(tmp_path, "hosted", "--new", URL_A, "--body", "body.md")
    assert out.count(OPEN) == 1
    assert URL_A in out
    assert out.endswith(f"{CLOSE}\n\nCloses the ticket\n")


def test_non_utf8_body_fails_without_traceback(tmp_path):
    touch(tmp_path, "a.png")
    (tmp_path / "b.md").write_bytes(b"\xff\xfe")
    err = fails(tmp_path, "files", "--new", "a.png", "--body", "b.md")
    assert "UTF-8" in err
    assert "Traceback" not in err


def test_missing_body_file_is_named(tmp_path):
    touch(tmp_path, "a.png")
    assert "nope.md" in fails(tmp_path, "files", "--new", "a.png", "--body", "nope.md")


# --- usage ------------------------------------------------------------------


def test_no_subcommand_prints_usage(tmp_path):
    r = cli(tmp_path)
    assert r.returncode == 2
    assert "usage:" in r.stderr
