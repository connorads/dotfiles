"""Opt-in npm BB 0.50.1 copy checks; these do not establish source authenticity."""
# ruff: noqa: PT009 - standard-library unittest suite; no pytest dependency

import os
import tempfile
import unittest
from pathlib import Path

from adapters import bb_0_50_1
from bb_patch import FILES
from package_candidate import _tree_digest, prepare_package


@unittest.skipUnless(os.environ.get("BB_PATCH_PACKAGE_0501"), "BB_PATCH_PACKAGE_0501 not set")
class RealPackage0501Tests(unittest.TestCase):
    def test_activity_and_combined_patch_copies_and_keep_source_unchanged(self):
        source = Path(os.environ["BB_PATCH_PACKAGE_0501"]).resolve(strict=True)
        node = Path(os.environ["BB_PATCH_NODE"]).resolve(strict=True)
        before = _tree_digest(source)
        metadata = {path: path.stat() for path in (source, *source.rglob("*"))}
        with tempfile.TemporaryDirectory(prefix="bb-package-0501-") as temporary:
            for set_id, applied, plugin in (
                (
                    "activity",
                    ["activity"],
                    "3fb7481c8b874c0e409be81523326e5736ad2bdd9e23ee0ee14d099bbea7dc3a",
                ),
                (
                    "session-options-plus-activity",
                    ["session-options", "activity"],
                    "dc8a16d9c2e373b82fb5cc00b46a4dacce0d2c772e049295bfb0fbef24df0813",
                ),
            ):
                with self.subTest(set_id=set_id):
                    report = prepare_package(
                        source, Path(temporary).resolve() / "releases", node, set_id
                    )
                    self.assertEqual(report["version"], "0.50.1")
                    self.assertEqual(report["status"], "patched", report.get("warning"))
                    self.assertEqual(report["appliedPatches"], applied)
                    self.assertEqual(report["failedPatches"], {})
                    self.assertEqual(
                        report["hashes"]["after"][FILES[0]],
                        "06e9c65e0b6a1f89efd3ddab470371b1c2216e1e0283703a38b8cc15ca321bae",
                    )
                    self.assertEqual(report["hashes"]["after"][FILES[1]], plugin)
                    for name in FILES[2:]:
                        original = (source / "server/dist" / name).read_bytes()
                        expected = (
                            bb_0_50_1.transform("session-options", name, original)
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
