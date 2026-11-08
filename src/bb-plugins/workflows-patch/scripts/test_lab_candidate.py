"""Disposable candidate evidence rejects stale checks without touching sources."""

# ruff: noqa: PT009, PT027
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bb_patch import canonical, digest
from lab_candidate import dependency_digest, file_digest, verify_receipt
from package_candidate import _tree_digest


class LabCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.package = self.root / "release/package"
        self.package.mkdir(parents=True)
        (self.package / "code.js").write_text("// candidate")
        self.node = self.root / "node"
        self.node.write_bytes(b"synthetic node")
        self.deps = self.root / "dependencies"
        self.deps.mkdir()
        (self.deps / "module.js").write_text("// dependencies")
        report = {
            "package": str(self.package),
            "packageTree": _tree_digest(self.package),
            "provenance": {},
        }
        payload = {
            "schema": 1,
            "scope": "disposable-only",
            "report": report,
            "inputs": {
                "node": str(self.node),
                "nodeHash": file_digest(self.node),
                "dependencyRoot": str(self.deps),
                "dependencyHash": dependency_digest(self.deps),
            },
        }
        self.receipt = self.package.parent / "verification.json"
        self.receipt.write_bytes(canonical({**payload, "receiptId": digest(canonical(payload))}))

    def test_unchanged_candidate_remains_verifiable(self):
        self.assertEqual(verify_receipt(self.receipt)["report"]["package"], str(self.package))

    def test_candidate_changes_invalidate_prior_evidence(self):
        (self.package / "code.js").write_text("// changed")
        with self.assertRaisesRegex(ValueError, "Candidate changed"):
            verify_receipt(self.receipt)

    def test_runtime_changes_with_same_name_invalidate_evidence(self):
        self.node.write_text("new runtime")
        with self.assertRaisesRegex(ValueError, "Runtime or dependencies"):
            verify_receipt(self.receipt)

    def test_dependency_changes_invalidate_evidence(self):
        (self.deps / "module.js").write_text("new dependency")
        with self.assertRaisesRegex(ValueError, "Runtime or dependencies"):
            verify_receipt(self.receipt)

    def test_external_dependency_links_are_not_trusted(self):
        (self.deps / "outside").symlink_to(self.node)
        with self.assertRaisesRegex(ValueError, "escapes"):
            dependency_digest(self.deps)

    def test_modified_receipt_cannot_reuse_old_identity(self):
        data = json.loads(self.receipt.read_bytes())
        data["report"]["packageTree"] = "changed"
        self.receipt.write_text(json.dumps(data))
        with self.assertRaisesRegex(ValueError, "Invalid verification"):
            verify_receipt(self.receipt)

    def test_unknown_release_is_blocked_before_preparation(self):
        from lab_candidate import prepare_verified

        (self.package / "package.json").write_text('{"version":"99.0.0"}')
        with (
            patch("lab_candidate.prepare_package") as prepare,
            self.assertRaisesRegex(ValueError, "exact-release"),
        ):
            prepare_verified(self.package, self.root / "output", self.node)
        prepare.assert_not_called()
