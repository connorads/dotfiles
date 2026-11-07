"""Package preparation uses synthetic files and never starts a server."""
# ruff: noqa: PT009, PT027 - standard-library unittest suite; no pytest dependency

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from adapters import bb_0_47_1, bb_0_48_1
from bb_patch import FILES, digest
from package_candidate import DEFAULT_HARNESSES, EXACT_RECIPES, prepare_package

CORE_ANCHORS = "\n".join(
    [
        "function buildThreadActivityStateByThreadId(deps, threads2) {",
        "    if (!backgroundActivity && !promptBannerActivity) {",
        "activeWorkflowCount: backgroundActivity?.activeWorkflowCount ?? EMPTY_THREAD_ACTIVITY.activeWorkflowCount",
        "  const api = {\n    pluginId,",
        "        pendingNeedsConfiguration = null;\n      }\n    },\n    closeWebSockets()",
        "      invalidated = true;\n      rpcCaller.revoke();",
        "      publishSignal: (channel, payload) => {\n        deps.hub.notifyPluginSignal(row.id, channel, payload);\n      },",
    ]
)
PLUGIN_ANCHORS = (
    "function D(u){x.rpc.experimental_invalidate([`runs:${u}`])}let t=cv(x,A,r);e.onChange"
)


class PackageCandidateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.package = self.root / "installed/node_modules/bb-app"
        self.package.mkdir(parents=True)
        (self.package / "package.json").write_text('{"version":"99.0.0"}')
        for name in ("dist/bb-app.js", *(f"server/dist/{n}" for n in FILES)):
            path = self.package / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("// synthetic stock\n")
        (self.package / "app/dist").mkdir(parents=True)
        executable = shutil.which("node")
        if executable is None:
            self.skipTest("Node executable unavailable")
        self.node = Path(executable).resolve()
        self.output = self.root / "releases"

    def prepare(self, source=None, output=None, set_id="activity"):
        return prepare_package(source or self.package, output or self.output, self.node, set_id)

    def stock(self, report):
        self.assertEqual(report["status"], "stock")
        self.assertEqual(report["hashes"]["before"], report["hashes"]["after"])
        for name in FILES:
            self.assertEqual(
                (Path(report["package"]) / "server/dist" / name).read_bytes(),
                (self.package / "server/dist" / name).read_bytes(),
            )
        json.dumps(report)

    def exact_fixture(self):
        (self.package / "package.json").write_text('{"version":"0.48.1"}')
        (self.package / "server/dist" / FILES[0]).write_text(CORE_ANCHORS)
        (self.package / "server/dist" / FILES[1]).write_text(PLUGIN_ANCHORS)
        return patch.dict(
            EXACT_RECIPES["0.48.1"]["pristine"],
            {
                name: digest((self.package / "server/dist" / name).read_bytes())
                for name in FILES[:2]
            },
        )

    def test_exact_048_1_selects_rpc_recipe(self):
        def check_pristine(directory, node, patches, **_):
            for name in FILES[:2]:
                self.assertEqual(
                    (directory / "pristine" / name).read_bytes(),
                    (self.package / "server/dist" / name).read_bytes(),
                )

        with (
            self.exact_fixture(),
            patch("package_candidate._check_candidate", side_effect=check_pristine) as check,
        ):
            result = self.prepare()
        self.assertEqual(result["status"], "patched", result.get("warning"))
        self.assertEqual(
            check.call_args.kwargs["harnesses"],
            {
                "session-options": "scripts/test-bundle-0.48.1.mjs",
                "activity": "scripts/test-activity-0.48.1.mjs",
            },
        )
        for name in FILES:
            original = (self.package / "server/dist" / name).read_bytes()
            self.assertEqual(
                (Path(result["package"]) / "server/dist" / name).read_bytes(),
                bb_0_48_1.transform("activity", name, original),
            )
        self.assertEqual(
            set(result["provenance"]["recipe"]),
            {
                "scripts/package_candidate.py",
                "scripts/bb_patch.py",
                "scripts/adapters/bb_0_47_1.py",
                "scripts/adapters/bb_0_48_1.py",
            },
        )
        self.assertEqual(
            set(result["provenance"]["tests"]),
            {"scripts/test-bundle-0.48.1.mjs", "scripts/test-activity-0.48.1.mjs"},
        )

    def test_048_1_session_options_without_anchors_retains_stock(self):
        with self.exact_fixture(), patch("package_candidate._check_candidate"):
            result = self.prepare(set_id="session-options-plus-activity")
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["appliedPatches"], ["activity"])
        self.assertEqual(list(result["failedPatches"]), ["session-options"])
        self.assertRegex(
            result["failedPatches"]["session-options"],
            "^Patch incompatible: Expected one occurrence",
        )
        for name in FILES[2:]:
            self.assertEqual(
                (Path(result["package"]) / "server/dist" / name).read_bytes(),
                (self.package / "server/dist" / name).read_bytes(),
            )

    def test_unrecognised_048_1_bytes_retain_stock(self):
        for name in FILES[:2]:
            with (
                self.subTest(name=name),
                self.exact_fixture(),
                patch("package_candidate._check_candidate") as check,
            ):
                path = self.package / "server/dist" / name
                path.write_bytes(path.read_bytes() + b"// changed")
                result = self.prepare(set_id="session-options-plus-activity")
            self.stock(result)
            check.assert_not_called()
            self.assertEqual(
                result["failedPatches"],
                {
                    patch: "Unrecognised 0.48.1 input bytes"
                    for patch in ("session-options", "activity")
                },
            )

    def test_other_versions_keep_default_recipe(self):
        (self.package / "server/dist" / FILES[0]).write_text(CORE_ANCHORS)
        (self.package / "server/dist" / FILES[1]).write_text(
            "function D(u){x.realtime.publish(_a,{threadId:u})}let t=pv(x,A,r);e.onChange"
        )
        for version in ("0.48.0", "99.0.0"):
            with (
                self.subTest(version=version),
                patch("package_candidate._check_candidate") as check,
            ):
                (self.package / "package.json").write_text(json.dumps({"version": version}))
                result = self.prepare()
            self.assertEqual(result["status"], "patched")
            self.assertEqual(check.call_args.kwargs["harnesses"], DEFAULT_HARNESSES)
            for name in FILES:
                original = (self.package / "server/dist" / name).read_bytes()
                self.assertEqual(
                    (Path(result["package"]) / "server/dist" / name).read_bytes(),
                    bb_0_47_1.transform("activity", name, original),
                )
            self.assertEqual(
                set(result["provenance"]["recipe"]),
                {
                    "scripts/package_candidate.py",
                    "scripts/bb_patch.py",
                    "scripts/adapters/bb_0_47_1.py",
                },
            )
            self.assertEqual(set(result["provenance"]["tests"]), set(DEFAULT_HARNESSES.values()))

    def test_future_version_cannot_select_rpc_recipe_by_anchor_match(self):
        self.exact_fixture()
        (self.package / "package.json").write_text('{"version":"0.48.2"}')
        with patch("package_candidate._check_candidate") as check:
            result = self.prepare()
        self.stock(result)
        check.assert_not_called()
        self.assertIn("realtime.publish", result["failedPatches"]["activity"])

    def test_default_recipe_keeps_default_harnesses(self):
        with (
            patch("package_candidate.transform", side_effect=lambda p, n, b: b),
            patch("package_candidate._check_candidate") as check,
        ):
            self.prepare(set_id="session-options-plus-activity")
        self.assertEqual(check.call_count, 2)
        for call in check.call_args_list:
            self.assertEqual(call.kwargs["harnesses"], DEFAULT_HARNESSES)

    def test_incompatible_transformation_retains_stock_and_reuses_identity(self):
        first = self.prepare()
        self.stock(first)
        self.assertIn("incompatible", first["warning"])
        second = self.prepare()
        self.assertEqual(first, second)
        self.assertEqual(len(list(self.output.iterdir())), 1)
        self.assertEqual(
            (Path(first["package"]).parent / "node_modules").resolve(), self.package.parent
        )

    def test_check_failure_discards_all_transformed_bytes(self):
        with (
            patch("package_candidate.transform", side_effect=lambda p, n, b: b + b"// patch\n"),
            patch(
                "package_candidate._check_candidate", side_effect=ValueError("synthetic failure")
            ),
        ):
            result = self.prepare()
        self.stock(result)
        self.assertIn("synthetic failure", result["warning"])

    def test_success_publishes_all_checked_bytes_and_preserves_source(self):
        with (
            patch("package_candidate.transform", side_effect=lambda p, n, b: b + b"// patch\n"),
            patch("package_candidate._check_candidate") as check,
        ):
            result = self.prepare()
        check.assert_called_once()
        self.assertEqual(result["status"], "patched")
        for name in FILES:
            original = (self.package / "server/dist" / name).read_bytes()
            self.assertEqual(original, b"// synthetic stock\n")
            self.assertEqual(
                (Path(result["package"]) / "server/dist" / name).read_bytes(),
                original + b"// patch\n",
            )

    def test_failed_feature_does_not_block_later_feature(self):
        def transform_feature(feature, name, data):
            if feature == "session-options" and name == FILES[2]:
                raise ValueError("incompatible view")
            return data + f"// {feature}\n".encode()

        with (
            patch("package_candidate.transform", side_effect=transform_feature),
            patch("package_candidate._check_candidate") as check,
        ):
            result = self.prepare(set_id="session-options-plus-activity")
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["appliedPatches"], ["activity"])
        self.assertEqual(list(result["failedPatches"]), ["session-options"])
        self.assertEqual(check.call_args.args[2], ["activity"])
        for name in FILES:
            self.assertEqual(
                (Path(result["package"]) / "server/dist" / name).read_bytes(),
                b"// synthetic stock\n// activity\n",
            )

    def test_later_harness_failure_preserves_accepted_feature(self):
        def check_feature(directory, node, features, **_):
            if features == ["activity"]:
                self.assertIn(b"// session-options", (directory / FILES[0]).read_bytes())
                raise ValueError("activity harness failure")

        with (
            patch(
                "package_candidate.transform", side_effect=lambda p, n, b: b + f"// {p}\n".encode()
            ),
            patch("package_candidate._check_candidate", side_effect=check_feature) as check,
        ):
            result = self.prepare(set_id="session-options-plus-activity")
        self.assertEqual(check.call_count, 2)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["appliedPatches"], ["session-options"])
        self.assertEqual(list(result["failedPatches"]), ["activity"])
        for name in FILES:
            self.assertEqual(
                (Path(result["package"]) / "server/dist" / name).read_bytes(),
                b"// synthetic stock\n// session-options\n",
            )

    def test_missing_patch_target_retains_future_stock_layout(self):
        (self.package / "server/dist" / FILES[0]).unlink()
        result = self.prepare()
        self.assertEqual(result["status"], "stock")
        self.assertEqual(result["appliedPatches"], [])
        self.assertEqual(list(result["failedPatches"]), ["activity"])
        self.assertIsNone(result["hashes"]["before"][FILES[0]])
        self.assertEqual(result["hashes"]["before"], result["hashes"]["after"])
        self.assertFalse((Path(result["package"]) / "server/dist" / FILES[0]).exists())
        self.assertEqual(self.prepare(), result)
        # Reuse must preserve absence as well as matching present bytes.
        (Path(result["package"]) / "server/dist" / FILES[0]).write_text("unexpected")
        with self.assertRaisesRegex(ValueError, "corrupt"):
            self.prepare()

    def test_check_timeout_retains_stock(self):
        with (
            patch("package_candidate.transform", side_effect=lambda p, n, b: b + b"// patch\n"),
            patch(
                "package_candidate._check_candidate",
                side_effect=subprocess.TimeoutExpired("node", 60),
            ),
        ):
            result = self.prepare()
        self.stock(result)
        self.assertIn("timed out", result["warning"])

    def test_corrupt_release_refused(self):
        result = self.prepare()
        (Path(result["package"]) / "server/dist" / FILES[0]).write_text("corrupt")
        with self.assertRaisesRegex(ValueError, "corrupt"):
            self.prepare()

    def test_corrupt_cached_entrypoint_refused(self):
        result = self.prepare()
        (Path(result["package"]) / "dist/bb-app.js").write_text("corrupt")
        with self.assertRaisesRegex(ValueError, "corrupt"):
            self.prepare()

    def test_changed_source_files_outside_patch_targets_get_new_identity(self):
        first = self.prepare()
        (self.package / "dist/bb-app.js").write_text("// updated launcher")
        second = self.prepare()
        self.assertNotEqual(first["identity"], second["identity"])
        self.assertEqual(
            (Path(second["package"]) / "dist/bb-app.js").read_text(), "// updated launcher"
        )
        asset = self.package / "app/dist/asset.js"
        asset.write_text("// new asset")
        third = self.prepare()
        self.assertNotEqual(second["identity"], third["identity"])
        self.assertEqual((Path(third["package"]) / "app/dist/asset.js").read_text(), "// new asset")

    def test_transient_verification_failure_creates_distinct_stock_artifact(self):
        with patch("package_candidate.transform", side_effect=lambda p, n, b: b + b"// patch\n"):
            with patch("package_candidate._check_candidate"):
                patched = self.prepare()
            with patch(
                "package_candidate._check_candidate",
                side_effect=subprocess.TimeoutExpired("node", 60),
            ):
                stock = self.prepare()
        self.assertEqual(patched["status"], "patched")
        self.stock(stock)
        self.assertEqual(patched["sourceTree"], stock["sourceTree"])
        self.assertNotEqual(patched["packageTree"], stock["packageTree"])
        self.assertNotEqual(patched["identity"], stock["identity"])

    def test_source_symlink_resolves_to_installed_package(self):
        alias = self.root / "package-alias"
        alias.symlink_to(self.package, target_is_directory=True)
        self.stock(self.prepare(source=alias))

    def test_unsafe_paths_and_missing_layout_refused_before_output(self):
        for output in (Path("relative"), self.package / "release", self.package.parent):
            with self.subTest(output=output), self.assertRaises(ValueError):
                self.prepare(output=output)
        alias = self.root / "store-alias"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            self.prepare(output=alias / "release")
        (self.package / "dist/bb-app.js").unlink()
        with self.assertRaisesRegex(ValueError, "Missing"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_copy_failure_is_hard_error(self):
        with (
            patch("package_candidate.shutil.copytree", side_effect=OSError("copy failed")),
            self.assertRaisesRegex(OSError, "copy failed"),
        ):
            self.prepare()


if __name__ == "__main__":
    unittest.main()
