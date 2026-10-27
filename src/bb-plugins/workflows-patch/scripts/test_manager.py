"""Registry and planning tests use independent synthetic installations only."""
# ruff: noqa: PT009, PT027 - standard-library unittest suite; no pytest dependency

import copy
import itertools
import json
import plistlib
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import bb_patch as manager


class Fixture(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix="bb-manager-test-")).resolve()
        self.app = self.directory / "fixture.app"
        self.root = self.directory / "registry-root"
        self.state = self.directory / "state"
        self.output = self.directory / "candidate"
        self.registry = self.root / "manifests"
        self.registry.mkdir(parents=True)
        self.adapter = self.root / "scripts/adapters/bb_0_47_1.py"
        self.adapter.parent.mkdir(parents=True)
        self.adapter.write_text(
            'def transform(patch, name, data):\n    return data + ("\\n// " + patch).encode()\n'
        )
        for harness in ("test-bundle.mjs", "test-activity.mjs"):
            (self.root / "scripts" / harness).write_text(
                'import assert from "node:assert/strict"; import {readFileSync} from "node:fs"; assert.ok(readFileSync(process.argv[2], "utf8").includes("// "));\n'
            )
        self.pristine = {n: f"// synthetic {i}\n".encode() for i, n in enumerate(manager.FILES)}
        for n, data in self.pristine.items():
            p = self.app / manager.DIST / n
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        (self.app / "Contents/Info.plist").write_bytes(
            plistlib.dumps(
                {"CFBundleExecutable": "fixture", "CFBundleShortVersionString": "0.47.1"}
            )
        )
        executable = self.app / "Contents/MacOS/fixture"
        executable.parent.mkdir()
        executable.write_bytes(b"\xcf\xfa\xed\xfe" + struct.pack("<I", 0x100000C))
        self.manifest_values = []
        for set_id, patches in manager.SETS.items():
            entries = []
            for name, data in self.pristine.items():
                steps = []
                for feature in patches:
                    data += f"\n// {feature}".encode()
                    steps.append(manager.digest(data))
                entries.append(
                    {
                        "path": name,
                        "pristine": manager.digest(self.pristine[name]),
                        "intermediate": steps,
                        "final": steps[-1],
                    }
                )
            profiles = patches
            harnesses = {
                f"scripts/test-{'bundle' if p == 'session-options' else 'activity'}.mjs": manager.digest(
                    (
                        self.root
                        / "scripts"
                        / f"test-{'bundle' if p == 'session-options' else 'activity'}.mjs"
                    ).read_bytes()
                )
                for p in patches
            }
            self.manifest_values.append(
                {
                    "schema": 1,
                    "id": set_id,
                    "status": "approved-offline",
                    "installation": {
                        "kind": "desktop",
                        "platform": "darwin",
                        "arch": "arm64",
                        "version": "0.47.1",
                    },
                    "dist": manager.DIST,
                    "patches": patches,
                    "adapter": {
                        "path": "scripts/adapters/bb_0_47_1.py",
                        "sha256": manager.digest(self.adapter.read_bytes()),
                    },
                    "files": entries,
                    "verification": {"profiles": profiles, "harnesses": harnesses},
                    "activation": "full-server-activation",
                    "installerWritesDatabase": False,
                    "runtimeRecordCompatibility": "synthetic",
                    "integrityPolicy": "disposable",
                    "retireWhen": "synthetic",
                }
            )
        self.write_registry()
        self.root_patch = patch.object(manager, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.recipes = manager.manifests(self.registry)

    def write_registry(self):
        for value in self.manifest_values:
            (self.registry / (value["id"] + ".json")).write_text(json.dumps(value))

    def prepare(self, set_id="session-options", output=None):
        return manager.prepare(self.app, set_id, output or self.output, self.recipes, self.state)

    def report(self, required=None):
        return manager.classify(manager.observe(self.app), self.recipes, required, self.state)


class PlanningTests(Fixture):
    def test_absent_installation_reports_explicit_error_without_outputs(self):
        import subprocess
        import sys

        result = subprocess.run(
            [
                sys.executable,
                "-B",
                manager.__file__,
                "inspect",
                "--app",
                str(self.directory / "absent.app"),
                "--json",
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(result.stderr)["errorKind"], "not-installed")
        self.assertFalse(self.output.exists())
        self.assertFalse(self.state.exists())

    def test_stock_requirement_and_complete_composition(self):
        self.assertEqual(self.report()[1], 0)
        self.assertEqual(self.report("activity")[1], 1)
        self.assertEqual(self.report("activity")[0]["missingPatches"], ["activity"])
        for recipe in self.recipes:
            data = manager.generate(recipe, self.pristine)
            for n, content in data.items():
                (self.app / manager.DIST / n).write_bytes(content)
            self.assertEqual(self.report()[0]["observedSet"], recipe["id"])
            if recipe["id"] == "session-options-plus-activity":
                for requirement in manager.SETS:
                    self.assertEqual(self.report(requirement)[1], 0)

    def test_draft_tuple_cannot_satisfy_inspection(self):
        recipe = next(r for r in self.recipes if r["id"] == "activity")
        recipe["status"] = "draft"
        self.prepare("activity")
        manager.verify(self.output / "plan.json", self.recipes)
        for name, data in manager.generate(recipe, self.pristine).items():
            (self.app / manager.DIST / name).write_bytes(data)
        report, code = self.report("activity")
        self.assertNotEqual(code, 0)
        self.assertEqual(report["diskRequirementStatus"], "blocked")
        self.assertEqual(report["missingPatches"], ["activity"])

    def test_registry_retains_release_scoped_sets_and_pristine_tuples(self):
        for recipe in self.manifest_values:
            other = copy.deepcopy(recipe)
            other["installation"]["version"] = "0.47.2"
            for entry in other["files"]:
                entry["pristine"] = "a" * 64
            (self.registry / ("next-" + other["id"] + ".json")).write_text(json.dumps(other))
        # Admission remains explicit, even when more than one release is retained.
        with patch.dict(manager.RELEASE_ADAPTERS, {"0.47.2": "scripts/adapters/bb_0_47_2.py"}):
            for path in self.registry.glob("next-*.json"):
                value = json.loads(path.read_text())
                value["adapter"]["path"] = "scripts/adapters/bb_0_47_2.py"
                path.write_text(json.dumps(value))
            recipes = manager.manifests(self.registry)
        self.assertEqual(len(recipes), 6)
        self.assertEqual(
            manager.classify(manager.observe(self.app), recipes, state=self.state)[1], 0
        )

    def test_every_known_file_mixture_is_unhealthy(self):
        profiles = [{n: manager.digest(b) for n, b in self.pristine.items()}]
        profiles.extend({e["path"]: e["final"] for e in r["files"]} for r in self.recipes)
        observation = manager.observe(self.app)
        for values in itertools.product(range(4), repeat=4):
            observation["tuple"] = {
                n: profiles[i][n] for n, i in zip(manager.FILES, values, strict=True)
            }
            report, code = manager.classify(observation, self.recipes, state=self.state)
            self.assertEqual(code == 0, observation["tuple"] in profiles, report)
            legacy_index = 1 + next(
                i for i, r in enumerate(self.recipes) if r["id"] == "session-options"
            )
            if set(values) <= {0, legacy_index} and observation["tuple"] not in profiles:
                self.assertEqual(report["classification"], "legacy-mixed")

    def test_unknown_bytes_and_release_refuse_without_output(self):
        for mode in ("bytes", "release"):
            with self.subTest(mode=mode):
                if mode == "bytes":
                    (self.app / manager.DIST / manager.FILES[0]).write_bytes(b"unknown")
                else:
                    (self.app / manager.DIST / manager.FILES[0]).write_bytes(
                        self.pristine[manager.FILES[0]]
                    )
                    (self.app / "Contents/Info.plist").write_bytes(
                        plistlib.dumps(
                            {"CFBundleExecutable": "fixture", "CFBundleShortVersionString": "99.0"}
                        )
                    )
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_deterministic_prepare_never_mutates_installation(self):
        before = manager.observe(self.app)
        one = manager.read_json(self.prepare())
        two = manager.read_json(self.prepare(output=self.directory / "second"))
        self.assertEqual(one["payload"], two["payload"])
        self.assertEqual(one["candidateId"], two["candidateId"])
        self.assertEqual(before, manager.observe(self.app))
        manager.verify(self.output / "plan.json", self.recipes)
        with self.assertRaises(ValueError):
            self.prepare()

    def test_plan_and_evidence_tampering(self):
        plan_path = self.prepare()
        (self.output / "verification.json").write_text('{"success":true}')
        manager.verify(plan_path, self.recipes)
        evidence = manager.read_json(self.output / "verification.json")
        self.assertEqual(evidence["candidateId"], manager.read_json(plan_path)["candidateId"])
        self.assertEqual(evidence["runtimeVerificationStatus"], "unknown")
        original = plan_path.read_bytes()
        plan = manager.read_json(plan_path)
        plan["candidateId"] = "0" * 64
        plan["verified"] = True
        plan_path.write_bytes(manager.canonical(plan))
        with self.assertRaises(ValueError):
            manager.verify(plan_path, self.recipes)
        plan_path.write_bytes(original)
        (self.output / manager.FILES[0]).write_bytes(b"forged")
        with self.assertRaises(ValueError):
            manager.verify(plan_path, self.recipes)

    def test_adapter_harness_and_pristine_tampering(self):
        plan_path = self.prepare()
        for path in (
            self.adapter,
            self.root / "scripts/test-bundle.mjs",
            self.output / "pristine" / manager.FILES[0],
        ):
            original = path.read_bytes()
            path.write_bytes(original + b"\n// tampered")
            with self.assertRaises(ValueError):
                manager.verify(plan_path, self.recipes)
            path.write_bytes(original)

    def test_forged_success_does_not_skip_harness_execution(self):
        harness = self.root / "scripts/test-bundle.mjs"
        harness.write_text('throw new Error("synthetic failure");')
        self.manifest_values[0]["verification"]["harnesses"]["scripts/test-bundle.mjs"] = (
            manager.digest(harness.read_bytes())
        )
        self.write_registry()
        self.recipes = manager.manifests(self.registry)
        plan = self.prepare()
        import subprocess

        with self.assertRaises(subprocess.CalledProcessError):
            manager.verify(plan, self.recipes)

    def test_harness_cannot_verify_a_candidate_it_changes(self):
        harness = self.root / "scripts/test-bundle.mjs"
        harness.write_text(
            'import {writeFileSync} from "node:fs";writeFileSync(process.argv[2],"// changed during harness");'
        )
        self.manifest_values[0]["verification"]["harnesses"]["scripts/test-bundle.mjs"] = (
            manager.digest(harness.read_bytes())
        )
        self.write_registry()
        self.recipes = manager.manifests(self.registry)
        plan = self.prepare()
        with self.assertRaisesRegex(ValueError, "changed during execution"):
            manager.verify(plan, self.recipes)
        self.assertFalse((self.output / "verification.json").exists())

    def test_registry_rejects_malformed_manifests(self):
        original = copy.deepcopy(self.manifest_values)
        mutations = [
            lambda m: m.update(schema=2),
            lambda m: m["files"].pop(),
            lambda m: m["files"].append(m["files"][0]),
            lambda m: m["files"][0].update(path="../outside"),
            lambda m: m["files"][0].update(final="bad"),
            lambda m: m.update(patches=["undeclared"]),
            lambda m: m["verification"].update(profiles=["unknown"]),
        ]
        for mutate in mutations:
            self.manifest_values = copy.deepcopy(original)
            mutate(self.manifest_values[0])
            self.write_registry()
            with self.assertRaises(ValueError):
                manager.manifests(self.registry)
        (self.registry / "duplicate.json").write_text('{"schema":1,"schema":1}')
        with self.assertRaises(ValueError):
            manager.manifests(self.registry)

    def test_output_overlap_and_symlinks_refuse(self):
        for output in (self.app / "new", self.app.parent, self.app / "Contents" / ".." / "output"):
            with self.assertRaises(ValueError):
                self.prepare(output=output)
        link = self.directory / "alias"
        link.symlink_to(self.app, target_is_directory=True)
        with self.assertRaises(ValueError):
            manager.prepare(link, "session-options", self.output, self.recipes, self.state)
        target = self.app / manager.DIST / manager.FILES[0]
        original = target.read_bytes()
        target.unlink()
        outside = self.directory / "outside"
        outside.write_bytes(original)
        target.symlink_to(outside)
        with self.assertRaises(ValueError):
            self.prepare()

    def test_patched_input_requires_verified_pristine_objects(self):
        recipe = self.recipes[0]
        for n, data in manager.generate(recipe, self.pristine).items():
            (self.app / manager.DIST / n).write_bytes(data)
        with self.assertRaises(FileNotFoundError):
            self.prepare("activity")
        for data in self.pristine.values():
            manager.write_object(self.state, data)
        self.prepare("activity")
        manager.verify(self.output / "plan.json", self.recipes)


class TrackedRegistryTests(unittest.TestCase):
    def test_tracked_recipes_pin_current_adapter_and_harnesses(self):
        recipes = manager.manifests()
        self.assertEqual({r["id"] for r in recipes}, set(manager.SETS))
        for recipe in recipes:
            manager.checked_inputs(recipe)


if __name__ == "__main__":
    unittest.main()
