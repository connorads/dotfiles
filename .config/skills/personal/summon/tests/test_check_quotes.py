"""Behavioural tests for scripts/check-quotes.py.

Tests the public CLI contract: arguments, exit status, stdout, and the baseline
file it writes. Run: uv run --with pytest -- pytest tests/ -q  (from the skill root)
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check-quotes.py"

SOURCED = (
    '> "Convention over configuration."\n'
    "-- verbatim | blog: The Rails Doctrine, rubyonrails.org, 2016-01-01"
    " | https://rubyonrails.org/doctrine\n"
)


def write_skill(
    root: Path, dossiers: dict[str, str], baseline: dict[str, int] | None = None
) -> None:
    (root / "references").mkdir(parents=True, exist_ok=True)
    (root / "scripts").mkdir(parents=True, exist_ok=True)
    for name, body in dossiers.items():
        # An ## Aliases section is what marks a file as a dossier rather than a
        # reference doc, so fixtures carry one unless they supply their own.
        text = (
            body
            if "## Aliases" in body
            else f"# Persona\n\n## Aliases\n\n- {Path(name).stem}\n\n## Quotes\n\n{body}"
        )
        (root / "references" / name).write_text(text, encoding="utf-8")
    if baseline is not None:
        (root / "scripts" / "quote-baseline.json").write_text(
            json.dumps({"files": baseline}), encoding="utf-8"
        )


def run(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_sourced_quote_passes(tmp_path: Path) -> None:
    write_skill(tmp_path, {"good.md": SOURCED})
    result = run(tmp_path, "--all")
    assert result.returncode == 0, result.stdout


def test_unsourced_quote_fails_without_baseline(tmp_path: Path) -> None:
    write_skill(tmp_path, {"bad.md": '> "Simplicity is a prerequisite for reliability."\n'})
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "NO-SOURCE" in result.stdout


def test_baseline_grandfathers_existing_debt(tmp_path: Path) -> None:
    write_skill(tmp_path, {"bad.md": '> "An old unsourced line."\n'}, baseline={"bad.md": 1})
    result = run(tmp_path, "--all")
    assert result.returncode == 0, result.stdout


def test_exceeding_baseline_fails(tmp_path: Path) -> None:
    body = '> "One old line."\n\n> "A second, newly added line."\n'
    write_skill(tmp_path, {"bad.md": body}, baseline={"bad.md": 1})
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "baseline allows 1" in result.stdout


def test_improvement_below_baseline_reports_but_passes(tmp_path: Path) -> None:
    write_skill(tmp_path, {"ok.md": SOURCED}, baseline={"ok.md": 3})
    result = run(tmp_path, "--all")
    assert result.returncode == 0
    assert "--update-baseline" in result.stdout


@pytest.mark.parametrize(
    "attribution",
    [
        "-- various interviews",
        "-- widely attributed to him",
        "-- attributed to Tufte, widely cited",
        "-- on content philosophy",
        "-- his blog",
    ],
)
def test_weasel_attributions_are_rejected(tmp_path: Path, attribution: str) -> None:
    write_skill(tmp_path, {"weasel.md": f'> "Design is how it works."\n{attribution}\n'})
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "WEASEL" in result.stdout


def test_verbatim_without_a_pointer_is_rejected(tmp_path: Path) -> None:
    write_skill(
        tmp_path, {"nopointer.md": '> "A real line."\n-- verbatim | talk: Simple Made Easy\n'}
    )
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "NO-POINTER" in result.stdout


@pytest.mark.parametrize(
    "pointer",
    [
        "| https://example.com/post",
        "| book: DDIA, 1st end, p. 142",
        "| talk: Simple Made Easy, Strange Loop 2011, 12:04",
    ],
)
def test_each_pointer_shape_satisfies_verbatim(tmp_path: Path, pointer: str) -> None:
    write_skill(tmp_path, {"ptr.md": f'> "A real line."\n-- verbatim {pointer}\n'})
    assert run(tmp_path, "--all").returncode == 0


def test_paraphrase_marker_needs_no_source(tmp_path: Path) -> None:
    write_skill(tmp_path, {"para.md": '> "A remembered position."\n-- (paraphrase)\n'})
    assert run(tmp_path, "--all").returncode == 0


def test_bare_quote_syntax_is_checked_too(tmp_path: Path) -> None:
    # kent-beck.md hid 32 quotes from the old blockquote-only rule this way.
    write_skill(
        tmp_path, {"bare.md": '"Any fool can write code that a computer can understand."\n'}
    )
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "NO-SOURCE" in result.stdout


def test_numbered_bold_quote_syntax_is_checked_too(tmp_path: Path) -> None:
    # alberto-brandolini.md's syntax; same claim, same obligation.
    write_skill(tmp_path, {"num.md": '1. **"The model is a byproduct of the conversation."**\n'})
    result = run(tmp_path, "--all")
    assert result.returncode == 1


def test_conflicting_status_for_the_same_quote_fails_regardless_of_baseline(tmp_path: Path) -> None:
    body = f'{SOURCED}\n> "Convention over configuration."\n-- (paraphrase)\n'
    write_skill(tmp_path, {"conflict.md": body}, baseline={"conflict.md": 99})
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "STATUS-CONFLICT" in result.stdout


def test_quotes_inside_code_fences_are_ignored(tmp_path: Path) -> None:
    write_skill(tmp_path, {"fenced.md": '```\n> "not a quote, a code sample"\n```\n'})
    assert run(tmp_path, "--all").returncode == 0


def test_overlong_quote_is_flagged(tmp_path: Path) -> None:
    long_quote = " ".join(["word"] * 60)
    write_skill(tmp_path, {"long.md": f'> "{long_quote}"\n-- verbatim | https://example.com\n'})
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "TOO-LONG" in result.stdout


def test_template_is_not_checked(tmp_path: Path) -> None:
    write_skill(tmp_path, {"_template.md": '> "Quote here."\n'})
    assert run(tmp_path, "--all").returncode == 0


def test_update_baseline_writes_current_counts(tmp_path: Path) -> None:
    write_skill(tmp_path, {"debt.md": '> "One."\n\n> "Two."\n'})
    assert run(tmp_path, "--all", "--update-baseline").returncode == 0
    written = json.loads((tmp_path / "scripts" / "quote-baseline.json").read_text())
    assert written["files"] == {"debt.md": 2}
    assert run(tmp_path, "--all").returncode == 0


def test_named_files_are_checked_without_all(tmp_path: Path) -> None:
    write_skill(tmp_path, {"bad.md": '> "Unsourced."\n'})
    result = run(tmp_path, str(tmp_path / "references" / "bad.md"))
    assert result.returncode == 1


def test_no_targets_is_not_an_error(tmp_path: Path) -> None:
    write_skill(tmp_path, {})
    assert run(tmp_path, str(tmp_path / "README.md")).returncode == 0


def test_attribution_naming_another_persona_is_flagged(tmp_path: Path) -> None:
    # jony-ive.md carried Steve Jobs's line as "attributed jointly with Jobs".
    write_skill(
        tmp_path,
        {
            "jony-ive.md": '# Ive\n\n## Aliases\n\n- jony\n\n> "Design is how it works."\n'
            "-- verbatim | attributed jointly with Jobs, NYT, 2003 | https://example.com\n",
            "steve-jobs.md": "# Jobs\n\n## Aliases\n\n- jobs\n",
        },
    )
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "CROSS-NAME" in result.stdout


def test_relay_marker_permits_naming_another_persona(tmp_path: Path) -> None:
    write_skill(
        tmp_path,
        {
            "jony-ive.md": '# Ive\n\n## Aliases\n\n- jony\n\n> "A line."\n'
            "-- attributed | as quoted in a profile of Jobs, NYT, 2003 | https://example.com\n",
            "steve-jobs.md": "# Jobs\n\n## Aliases\n\n- jobs\n",
        },
    )
    assert run(tmp_path, "--all").returncode == 0


def test_borrowed_quote_phrasing_is_flagged(tmp_path: Path) -> None:
    # rich-hickey.md files Dijkstra's and Perlis's lines under Sourced Quotes.
    write_skill(
        tmp_path,
        {
            "h.md": '> "Simplicity is a prerequisite for reliability."\n-- Dijkstra quote he references constantly\n'
        },
    )
    result = run(tmp_path, "--all")
    assert result.returncode == 1
    assert "CROSS-NAME" in result.stdout


def test_misattributed_status_may_name_the_real_author(tmp_path: Path) -> None:
    write_skill(
        tmp_path,
        {
            "jony-ive.md": '# Ive\n\n## Aliases\n\n- jony\n\n> "Design is how it works."\n'
            "-- misattributed | actual: Steve Jobs | article: NYT Magazine, 2003-11-30 | https://example.com\n",
            "steve-jobs.md": "# Jobs\n\n## Aliases\n\n- jobs\n",
        },
    )
    assert run(tmp_path, "--all").returncode == 0


def test_real_corpus_is_within_its_baseline() -> None:
    """The shipped corpus must not regress past its recorded debt.

    This is the assertion that makes the hk skill-tests step an actual gate:
    adding a sourced quote is free, adding an unsourced one fails the commit.
    """
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--all"], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stdout
