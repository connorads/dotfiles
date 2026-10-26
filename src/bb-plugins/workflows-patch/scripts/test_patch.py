"""Exercise the patch CLI only against disposable copies of pinned bundles."""

import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch as replace

SCRIPT = Path(__file__).with_name("patch-bundle.py")
spec = importlib.util.spec_from_file_location("bundle_patch", SCRIPT)
assert spec is not None
assert spec.loader is not None
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


class PatchCliTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="workflows-patch-"))
        self.app = self.root / "bb.app"
        self.output = self.root / "prepared"
        for name, expected in patch.EXPECTED.items():
            data = (patch.APP / patch.DIST / name).read_bytes()
            assert patch.digest(data) == expected
            target = self.app / patch.DIST / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)

    def run_cli(self, action, output=None, success=True):
        result = subprocess.run(
            [
                "python3",
                str(SCRIPT),
                action,
                "--app",
                str(self.app),
                "--output",
                str(output or self.output),
            ],
            capture_output=True,
            text=True,
        )
        assert (result.returncode == 0) == success, result.stdout + result.stderr
        return result

    def assert_state(self, hashes):
        for name, expected in hashes.items():
            assert patch.digest((self.app / patch.DIST / name).read_bytes()) == expected

    def test_round_trip_and_idempotence(self):
        self.run_cli("check")
        self.run_cli("prepare")
        self.assert_state(patch.EXPECTED)
        self.run_cli("apply")
        self.run_cli("apply")
        self.assert_state(patch.PATCHED)
        self.run_cli("check")
        self.run_cli("restore")
        self.run_cli("restore")
        self.assert_state(patch.EXPECTED)

    def test_unknown_core_refused_without_outputs(self):
        (self.app / patch.DIST / "start-server.js").write_text("unexpected")
        self.run_cli("apply", success=False)
        assert not self.output.exists()

    def test_corrupt_backup_refuses_restore_before_any_write(self):
        self.run_cli("apply")
        (self.output / "backup" / next(iter(patch.PATCHED))).write_text("unexpected")
        self.run_cli("restore", success=False)
        self.assert_state(patch.PATCHED)

    def test_missing_backup_refuses_apply(self):
        self.run_cli("apply")
        self.run_cli("apply", output=self.root / "missing", success=False)
        self.assert_state(patch.PATCHED)

    def test_prepare_must_not_overwrite_installation(self):
        self.run_cli("prepare", output=self.app / patch.DIST, success=False)
        self.assert_state(patch.EXPECTED)

    def test_prepare_must_not_overwrite_unrecognised_output(self):
        target = self.output / next(iter(patch.PATCHED))
        target.parent.mkdir(parents=True)
        target.write_text("unrelated")
        self.run_cli("prepare", success=False)
        assert target.read_text() == "unrelated"
        self.assert_state(patch.EXPECTED)

    def test_unknown_plugin_refuses_before_any_write(self):
        name = next(iter(patch.PATCHED))
        (self.app / patch.DIST / name).write_text("unexpected")
        self.run_cli("apply", success=False)
        assert not self.output.exists()

    def test_mixed_state_can_restore_from_verified_backups(self):
        self.run_cli("apply")
        name = next(iter(patch.PATCHED))
        target = self.app / patch.DIST / name
        target.write_bytes((self.output / "backup" / name).read_bytes())
        self.run_cli("check")
        self.run_cli("restore")
        self.assert_state(patch.EXPECTED)

    def test_install_and_restore_write_failures_roll_back(self):
        names = list(patch.PATCHED)
        targets = {name: self.app / patch.DIST / name for name in names}
        before = {name: target.read_bytes() for name, target in targets.items()}
        patchers = [patch.patch_server, patch.patch_app, patch.patch_authoring]
        after = {
            name: transform(before[name].decode()).encode()
            for name, transform in zip(names, patchers, strict=True)
        }
        write = patch.atomic_write
        for original, desired in [(before, after), (after, before)]:
            for name in names:
                targets[name].write_bytes(original[name])
            attempts = []

            def fail_second(target, data, attempts=attempts):
                attempts.append(target)
                if len(attempts) == 2:
                    raise OSError("Synthetic write failure")
                write(target, data)

            with replace.object(patch, "atomic_write", fail_second), self.assertRaises(OSError):  # noqa: PT027 - standard-library suite
                patch.install(targets, original, desired, names)
            for name in names:
                assert targets[name].read_bytes() == original[name]


if __name__ == "__main__":
    unittest.main()
