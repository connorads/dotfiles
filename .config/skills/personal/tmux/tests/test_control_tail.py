"""Parsing and subprocess tests for the tmux control stream."""

import importlib.util
import os
import signal
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "control-tail.py"
spec = importlib.util.spec_from_file_location("control_tail", SCRIPT)
control_tail = importlib.util.module_from_spec(spec)
sys.modules["control_tail"] = control_tail  # dataclasses resolves the module by name
spec.loader.exec_module(control_tail)

decode_tmux_payload = control_tail.decode_tmux_payload
parse_output_line = control_tail.parse_output_line


@pytest.mark.parametrize(
    ("burst", "expected_status", "message"),
    [
        (
            b"%begin 0 0 0\n%end 0 0 0\n%output %1 ignored\n%output %2 target-only\n",
            0,
            "Pattern 'target-only' found",
        ),
        (b"%output %2 " + b"x" * 65536 + b"target-only\n", 0, "Pattern 'target-only' found"),
        (b"%output %1 target-only\n", 1, "Timeout after"),
        (b"%output %2 incomplete", 1, "Timeout after"),
    ],
    ids=["burst", "line-spans-reads", "other-pane", "incomplete-line"],
)
def test_control_stream_handles_bursts_and_incomplete_lines(
    tmp_path, burst, expected_status, message
):
    fake_tmux = tmp_path / "tmux"
    fake_tmux.write_text(
        f"#!{sys.executable}\n"
        "import os, sys\n"
        "if sys.argv[1] == 'display-message':\n"
        "    print('%2|$1')\n"
        "elif sys.argv[1] == '-C':\n"
        f"    os.write(1, {burst!r})\n"
        "    sys.stdin.readline()\n"
    )
    fake_tmux.chmod(0o755)
    process = subprocess.Popen(
        [sys.executable, str(SCRIPT), "-t", "%2", "-p", "target-only", "--no-seed", "-T", "1"],
        env=dict(os.environ, TMUX_BIN=str(fake_tmux)),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=5)
        assert process.returncode == expected_status, stdout + stderr
        assert message in stdout + stderr
    finally:
        # A blocked reader must not leave its fake tmux child behind.
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()


class TestDecodeTmuxPayload:
    def test_plain_bytes_pass_through(self):
        assert decode_tmux_payload(b"hello world") == b"hello world"

    def test_octal_escape_decodes(self):
        assert decode_tmux_payload(b"a\\015b") == b"a\rb"

    def test_escaped_backslash(self):
        assert decode_tmux_payload(b"\\134") == b"\\"

    def test_escape_at_end_of_payload(self):
        assert decode_tmux_payload(b"\\033") == b"\x1b"

    def test_incomplete_escape_stays_literal(self):
        assert decode_tmux_payload(b"abc\\13") == b"abc\\13"

    def test_non_octal_after_backslash_stays_literal(self):
        assert decode_tmux_payload(b"\\9ab") == b"\\9ab"

    def test_consecutive_escapes(self):
        assert decode_tmux_payload(b"\\015\\012") == b"\r\n"


class TestParseOutputLine:
    def test_output_line(self):
        assert parse_output_line(b"%output %1 hello world\n") == (
            b"%1",
            b"hello world",
        )

    def test_output_line_preserves_pane_for_caller_filtering(self):
        pane, payload = parse_output_line(b"%output %2 other pane\n")
        assert pane == b"%2"
        assert payload == b"other pane"

    def test_extended_output_line(self):
        assert parse_output_line(b"%extended-output %1 0 : payload with spaces\n") == (
            b"%1",
            b"payload with spaces",
        )

    def test_extended_output_empty_payload(self):
        assert parse_output_line(b"%extended-output %1 0 age :\n") == (b"%1", b"")

    def test_extended_output_without_delimiter_is_none(self):
        assert parse_output_line(b"%extended-output %1 0 1 2\n") is None

    def test_non_output_notification_is_none(self):
        assert parse_output_line(b"%begin 1721 0 1\n") is None

    def test_truncated_output_line_is_none(self):
        assert parse_output_line(b"%output %1\n") is None
