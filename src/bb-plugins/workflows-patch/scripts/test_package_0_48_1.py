"""Opt-in npm BB 0.48.1 copy checks; these do not establish source authenticity."""
# ruff: noqa: PT009 - standard-library unittest suite; no pytest dependency

import os
import tempfile
import unittest
from pathlib import Path

from adapters import bb_0_48_1
from bb_patch import FILES
from package_candidate import _tree_digest, prepare_package


@unittest.skipUnless(os.environ.get("BB_PATCH_PACKAGE_0481"), "BB_PATCH_PACKAGE_0481 not set")
class RealPackage0481Tests(unittest.TestCase):
    def test_activity_and_combined_patch_copies_and_keep_source_unchanged(self):
        source = Path(os.environ["BB_PATCH_PACKAGE_0481"]).resolve(strict=True)
        node = Path(os.environ["BB_PATCH_NODE"]).resolve(strict=True)
        before = _tree_digest(source)
        metadata = {path: path.stat() for path in (source, *source.rglob("*"))}
        with tempfile.TemporaryDirectory(prefix="bb-package-0481-") as temporary:
            for set_id, applied, plugin in (
                (
                    "activity",
                    ["activity"],
                    "5b408e88b2f92e4d3d7cf8ffb11be96289db8b4e5581fda5d09b8cf62ee989cf",
                ),
                (
                    "session-options-plus-activity",
                    ["session-options", "activity"],
                    "9fe4573900fe0d78a974bd15bd883f286971d370ea4d34629cb8ab91a55cd4f0",
                ),
            ):
                with self.subTest(set_id=set_id):
                    report = prepare_package(
                        source, Path(temporary).resolve() / "releases", node, set_id
                    )
                    self.assertEqual(report["version"], "0.48.1")
                    self.assertEqual(report["status"], "patched", report.get("warning"))
                    self.assertEqual(report["appliedPatches"], applied)
                    self.assertEqual(report["failedPatches"], {})
                    self.assertEqual(
                        report["hashes"]["after"][FILES[0]],
                        "de1cdedb0820896ad53cd0bf35541567b03baaec9a930bb7a413b454a606fa18",
                    )
                    self.assertEqual(report["hashes"]["after"][FILES[1]], plugin)
                    for name in FILES[2:]:
                        original = (source / "server/dist" / name).read_bytes()
                        expected = (
                            bb_0_48_1.transform("session-options", name, original)
                            if "session-options" in applied
                            else original
                        )
                        self.assertEqual(
                            (Path(report["package"]) / "server/dist" / name).read_bytes(),
                            expected,
                        )
        self.assertEqual(_tree_digest(source), before)
        for path, info in metadata.items():
            after = path.stat()
            # Reading can update atime; writing must not change the source generation.
            self.assertEqual(
                (after.st_ino, after.st_size, after.st_mode, after.st_mtime_ns, after.st_ctime_ns),
                (info.st_ino, info.st_size, info.st_mode, info.st_mtime_ns, info.st_ctime_ns),
                str(path),
            )


if __name__ == "__main__":
    unittest.main()
