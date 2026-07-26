"""Unit tests for control-tail.py's pure parsing helpers."""

import importlib.util
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "scripts" / "control-tail.py"
spec = importlib.util.spec_from_file_location("control_tail", SCRIPT)
control_tail = importlib.util.module_from_spec(spec)
sys.modules["control_tail"] = control_tail  # dataclasses resolves the module by name
spec.loader.exec_module(control_tail)

decode_tmux_payload = control_tail.decode_tmux_payload
parse_output_line = control_tail.parse_output_line


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
