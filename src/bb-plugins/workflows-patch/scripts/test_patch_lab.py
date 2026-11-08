"""Guard rails for the disposable-only host runner."""

# ruff: noqa: PT009, PT027
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from patch_lab import (
    create,
    environment,
    launch,
    lock,
    owned_process,
    public_status,
    reconcile,
    safe_root,
    start,
    stop_process,
    temporary_root,
)


class PatchLabTests(unittest.TestCase):
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(dir=temporary_root())
        self.addCleanup(self.fixture.cleanup)
        self.source = Path(self.fixture.name).resolve()
        self.root = create(self.source, Path("/usr/bin/python3"))
        # Leave marked lab directories for system cleanup, matching the runner.

    def test_live_or_arbitrary_roots_are_refused(self):
        with self.assertRaisesRegex(ValueError, "canonical temporary"):
            safe_root(Path.home() / ".bb")
        with self.assertRaisesRegex(ValueError, "canonical temporary"):
            safe_root(self.source)

    def test_symlink_alias_does_not_admit_a_lab(self):
        link = self.source / "alias"
        link.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "canonical temporary"):
            safe_root(link)

    def test_marked_lab_is_private_and_live_activation_is_absent(self):
        result = public_status(self.root)
        self.assertEqual(result["phase"], "created")
        self.assertFalse(result["liveActivation"])
        self.assertEqual(self.root.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.root / "lab.json").stat().st_mode & 0o777, 0o600)

    def test_environment_does_not_inherit_credentials_or_live_data(self):
        with patch.dict(
            os.environ, {"EXAMPLE_API_KEY": "synthetic", "BB_DATA_DIR": "/example/live"}
        ):
            result = environment(self.root, 49999)
        self.assertNotIn("EXAMPLE_API_KEY", result)
        self.assertEqual(result["BB_DATA_DIR"], str(self.root / "data"))
        self.assertEqual(result["HOME"], str(self.root / "home"))
        self.assertEqual(result["BB_SERVER_BIND_HOST"], "127.0.0.1")
        for port in (38886, 80, 65536):
            with self.assertRaisesRegex(ValueError, "port refused"):
                environment(self.root, port)

    def test_foreign_process_identity_never_receives_a_signal(self):
        process = {"pid": 123, "signature": "some other server"}
        with (
            patch("patch_lab.signature", return_value="some other server"),
            patch("patch_lab.os.kill") as kill,
            self.assertRaisesRegex(ValueError, "identity differs"),
        ):
            stop_process(process, self.root)
        kill.assert_not_called()

    def test_pid_reuse_cannot_match_an_old_process(self):
        process = {"pid": 123, "signature": f"old {self.root}"}
        with (
            patch("patch_lab.signature", return_value=f"new {self.root}"),
            self.assertRaisesRegex(ValueError, "identity differs"),
        ):
            owned_process(process, self.root)

    def test_stale_revision_and_unprepared_restart_never_spawn(self):
        with patch("patch_lab.subprocess.Popen") as spawn:
            with self.assertRaisesRegex(ValueError, "changed"):
                start(self.root, "run", 0)
            with self.assertRaisesRegex(ValueError, "not admitted"):
                start(self.root, "run", public_status(self.root)["revision"])
        spawn.assert_not_called()

    def test_second_writer_is_refused(self):
        with (
            lock(self.root),
            self.assertRaisesRegex(ValueError, "already running"),
            lock(self.root),
        ):
            self.fail("second lock acquired")

    def test_server_entry_outside_lab_is_refused_before_spawn(self):
        with (
            patch("patch_lab.subprocess.Popen") as spawn,
            self.assertRaisesRegex(ValueError, "inside the disposable"),
        ):
            launch(self.root, safe_root(self.root), self.source, 49999)
        spawn.assert_not_called()

    def test_missing_background_worker_is_reported_as_interrupted(self):
        record = safe_root(self.root)
        record.update(phase="rehearsing", worker={"pid": 999, "signature": f"old {self.root}"})
        (self.root / "lab.json").write_text(json.dumps(record))
        with patch("patch_lab.signature", return_value=""):
            self.assertEqual(public_status(self.root)["phase"], "interrupted")

    def test_recovery_finishes_in_a_state_that_allows_a_fresh_lab(self):
        record = safe_root(self.root)
        record["phase"] = "interrupted"
        (self.root / "lab.json").write_text(json.dumps(record))
        result = reconcile(self.root)
        self.assertEqual(result["phase"], "stopped")
        self.assertIsNone(safe_root(self.root)["server"])
