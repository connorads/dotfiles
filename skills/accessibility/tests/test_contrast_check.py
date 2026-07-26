"""Behavioural tests for scripts/contrast-check.py (args, exit status, output)."""

import json
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "scripts" / "contrast-check.py"


def run(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def run_json(*args):
    result = run(*args, "--json")
    return result, json.loads(result.stdout)


def test_black_on_white_is_21_to_1_and_passes():
    result, payload = run_json("#000000", "#ffffff")
    assert result.returncode == 0
    assert payload["ratio"] == 21.0
    assert payload["passed"] is True


def test_767676_on_white_passes_aa_normal_text():
    result, payload = run_json("#767676", "#ffffff")
    assert result.returncode == 0
    assert abs(payload["ratio"] - 4.54) < 0.01
    assert payload["aa_normal_text"] is True


def test_949494_on_white_fails_normal_text_but_passes_large_text():
    result, payload = run_json("#949494", "#ffffff")
    assert result.returncode == 1
    assert abs(payload["ratio"] - 3.03) < 0.01
    assert payload["aa_normal_text"] is False

    large = run("#949494", "#ffffff", "--target", "large-text")
    assert large.returncode == 0


def test_invalid_hex_exits_2_with_error_on_stderr():
    result = run("zzz", "#ffffff")
    assert result.returncode == 2
    assert "Invalid hex colour" in result.stderr


def test_three_digit_shorthand_parses():
    result, payload = run_json("fff", "000")
    assert result.returncode == 0
    assert payload["ratio"] == 21.0


def test_text_output_reports_pass_fail_lines():
    result = run("#000000", "#ffffff")
    assert result.returncode == 0
    assert "Contrast ratio: 21.0000:1" in result.stdout
    assert "PASS" in result.stdout
