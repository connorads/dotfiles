"""Disposable transaction interruption and hostile-state tests."""
# ruff: noqa: PT009, PT027 - standard-library unittest suite; no pytest dependency

import os
import shutil
import stat
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import bb_patch as manager
from test_manager import Fixture


class TransactionTests(Fixture):
    def apply(self, checkpoint=manager.no_checkpoint):
        return manager.apply(
            self.app, self.output / "plan.json", self.state, self.recipes, checkpoint
        )

    def journal(self):
        path = next((self.state / "transactions").glob("*.json"))
        return path, manager.read_json(path)

    def restore(self, checkpoint=manager.no_checkpoint):
        _, journal = self.journal()
        manager.restore(self.app, journal["id"], self.state, checkpoint, self.recipes)

    def test_complete_round_trip_and_metadata(self):
        target = self.app / manager.DIST / manager.FILES[0]
        target.chmod(0o640)
        manager.set_xattrs(target, {"user.bb_synthetic": "73796e746865746963"})
        before = manager.observe(self.app)
        self.prepare("session-options-plus-activity")
        transaction_id = self.apply()
        self.assertEqual(self.apply(), transaction_id)
        self.assertEqual(len(list((self.state / "transactions").glob("*.json"))), 1)
        after = manager.observe(self.app)
        self.assertEqual(after["metadata"], before["metadata"])
        self.assertEqual(self.report("activity")[1], 0)
        self.assertEqual(self.journal()[1]["state"], "installed-pending-activation")
        self.restore()
        self.restore()
        self.assertEqual(manager.observe(self.app), before)

    def test_live_and_non_temporary_roots_refuse_before_state_write(self):
        for app in ("/Applications/bb.app", str(Path.home())):
            with self.assertRaises(ValueError):
                manager.apply(app, self.output / "missing.json", self.state)
            with self.assertRaises(ValueError):
                manager.restore(app, "0" * 32, self.state)
        self.assertFalse(self.state.exists())

    def test_environment_cannot_admit_live_or_home_roots(self):
        with (
            patch.object(manager.tempfile, "gettempdir", return_value="/Applications"),
            self.assertRaises(ValueError),
        ):
            manager.admit(Path("/Applications/bb.app"))
        with (
            patch.object(manager.tempfile, "gettempdir", return_value=str(Path.home())),
            self.assertRaises(ValueError),
        ):
            manager.admit(Path.home() / "src")
        self.assertFalse(self.state.exists())

    def test_draft_and_stale_binding_refuse(self):
        next(r for r in self.recipes if r["id"] == "session-options")["status"] = "draft"
        self.prepare()
        with self.assertRaises(ValueError):
            self.apply()
        self.assertFalse((self.state / "transactions").exists())
        next(r for r in self.recipes if r["id"] == "session-options")["status"] = "approved-offline"
        plan = manager.read_json(self.output / "plan.json")
        plan["payload"]["manifest"]["status"] = "approved-offline"
        plan["candidateId"] = manager.digest(manager.canonical(plan["payload"]))
        (self.output / "plan.json").write_bytes(manager.canonical(plan))
        (self.app / manager.DIST / manager.FILES[0]).write_text("changed")
        with self.assertRaises(ValueError):
            self.apply()

    def test_all_process_exit_boundaries_recover_using_actual_hashes(self):
        self.prepare()
        names = list(manager.FILES)
        boundaries = ["prepared", "backed-up", "installing", "installed-pending-activation"]
        boundaries += [
            f"{phase}:{n}" for phase in ("staged", "intent", "renamed", "recorded") for n in names
        ]
        for boundary in boundaries:
            with self.subTest(boundary=boundary):
                pid = os.fork()
                if pid == 0:

                    def terminate(label, boundary=boundary):
                        if label == boundary:
                            os._exit(73)

                    try:
                        self.apply(terminate)
                    except BaseException:
                        os._exit(74)
                    os._exit(0)
                _, status = os.waitpid(pid, 0)
                self.assertEqual(os.waitstatus_to_exitcode(status), 73)
                journals = list((self.state / "transactions").glob("*.json"))
                active = next(
                    manager.read_json(p)
                    for p in journals
                    if manager.read_json(p)["state"] != "restored"
                )
                manager.restore(self.app, active["id"], self.state, registry=self.recipes)
                self.assertEqual(
                    manager.observe(self.app)["tuple"],
                    {n: manager.digest(b) for n, b in self.pristine.items()},
                )

    def test_restore_process_exit_boundaries_are_idempotent(self):
        self.prepare()
        for boundary in [
            "restoring",
            "restored",
            *[
                f"{phase}:{n}"
                for phase in ("staged", "intent", "renamed", "recorded")
                for n in manager.FILES
            ],
        ]:
            transaction_id = self.apply()
            pid = os.fork()
            if pid == 0:

                def terminate(label, boundary=boundary):
                    if label == boundary:
                        os._exit(73)

                try:
                    manager.restore(self.app, transaction_id, self.state, terminate, self.recipes)
                except BaseException:
                    os._exit(74)
                os._exit(0)
            _, status = os.waitpid(pid, 0)
            self.assertEqual(os.waitstatus_to_exitcode(status), 73, boundary)
            manager.restore(self.app, transaction_id, self.state, registry=self.recipes)
            self.assertEqual(
                manager.observe(self.app)["tuple"],
                {n: manager.digest(b) for n, b in self.pristine.items()},
            )

    def test_forged_journal_and_release_generation_refuse(self):
        self.prepare()
        self.apply()
        path, journal = self.journal()
        original = path.read_bytes()
        journal["candidateId"] = "0" * 64
        path.write_bytes(manager.canonical(journal))
        with self.assertRaises(ValueError):
            self.restore()
        path.write_bytes(original)
        plist = self.app / "Contents/Info.plist"
        plist.write_bytes(plist.read_bytes().replace(b"0.47.1", b"0.47.2"))
        with self.assertRaises(ValueError):
            self.restore()

    def test_journal_mixture_and_unexpected_bytes(self):
        self.prepare()

        class Interrupted(BaseException):
            pass

        def interrupt(label):
            if label == f"renamed:{manager.FILES[0]}":
                raise Interrupted

        with self.assertRaises(Interrupted):
            self.apply(interrupt)
        self.assertEqual(self.report()[0]["classification"], "journal-backed-mixed")
        target = self.app / manager.DIST / manager.FILES[-1]
        target.write_bytes(b"unexpected guard")
        with self.assertRaises(ValueError):
            self.restore()
        self.assertEqual(target.read_bytes(), b"unexpected guard")

    def test_corrupt_and_missing_objects_block_before_writes(self):
        self.prepare()
        self.apply()
        before = manager.observe(self.app)
        _, journal = self.journal()
        key = next(iter(journal["before"].values()))
        target = self.state / "objects" / key
        original = target.read_bytes()
        target.write_bytes(b"corrupt")
        with self.assertRaises(ValueError):
            self.restore()
        self.assertEqual(manager.observe(self.app), before)
        target.unlink()
        with self.assertRaises(FileNotFoundError):
            self.restore()
        target.write_bytes(original)
        self.restore()

    def test_root_replacement_and_release_change_block(self):
        self.prepare()
        self.apply()
        old = self.app.with_name("old.app")
        self.app.rename(old)
        import shutil

        shutil.copytree(old, self.app)
        with self.assertRaises(ValueError):
            self.restore()
        self.assertEqual(self.journal()[1]["state"], "installed-pending-activation")

    def test_root_replacement_at_staging_preserves_replacement_tree(self):
        import shutil

        self.prepare()
        saved = {}

        def replace_root(label):
            if label == f"staged:{manager.FILES[0]}":
                old = self.app.with_name("original.app")
                self.app.rename(old)
                shutil.copytree(old, self.app)
                saved.update(
                    {
                        str(p.relative_to(self.app)): p.read_bytes()
                        for p in self.app.rglob("*")
                        if p.is_file()
                    }
                )

        with self.assertRaises(ValueError):
            self.apply(replace_root)
        self.assertEqual(
            saved,
            {
                str(p.relative_to(self.app)): p.read_bytes()
                for p in self.app.rglob("*")
                if p.is_file()
            },
        )
        self.assertEqual(self.journal()[1]["state"], "blocked-unexpected-bytes")

    def test_acl_added_during_staging_blocks_replacement(self):
        if sys.platform != "darwin":
            self.skipTest("Native macOS ACL fixture")
        self.prepare()
        target = self.app / manager.DIST / manager.FILES[1]

        def add_acl(label):
            if label == f"staged:{manager.FILES[0]}":
                subprocess.run(["/bin/chmod", "+a", "everyone allow read", str(target)], check=True)

        with self.assertRaises(ValueError):
            self.apply(add_acl)
        self.assertTrue(manager.metadata(target)["acl"])
        self.assertEqual(
            manager.observe(self.app)["tuple"],
            {n: manager.digest(b) for n, b in self.pristine.items()},
        )
        subprocess.run(["/bin/chmod", "-N", str(target)], check=True)

    def test_changed_staging_bytes_are_preserved_without_installation(self):
        self.prepare()
        unexpected = []

        def corrupt_stage(label):
            if label == f"staged:{manager.FILES[0]}":
                target = next((self.app / manager.DIST).glob(".bb-patch-*"))
                target.write_bytes(b"unexpected staged bytes")
                unexpected.append(target)

        with self.assertRaisesRegex(ValueError, "Staged candidate changed"):
            self.apply(corrupt_stage)
        self.assertEqual(unexpected[0].read_bytes(), b"unexpected staged bytes")
        self.assertEqual(
            manager.observe(self.app)["tuple"],
            {n: manager.digest(b) for n, b in self.pristine.items()},
        )

    def test_root_swap_at_replace_preserves_replacement_generation(self):
        self.prepare()
        original = manager.os.replace
        saved = {}

        def swap(source, target, **kwargs):
            if (
                kwargs.get("dst_dir_fd") is not None or str(target).endswith(manager.FILES[0])
            ) and not saved:
                old = self.app.with_name("displaced.app")
                self.app.rename(old)
                shutil.copytree(old, self.app)
                plist = self.app / "Contents/Info.plist"
                plist.write_bytes(plist.read_bytes().replace(b"0.47.1", b"0.47.2"))
                for name in manager.FILES:
                    (self.app / manager.DIST / name).write_bytes(b"replacement generation")
                saved.update(manager.observe(self.app))
            return original(source, target, **kwargs)

        with patch.object(manager.os, "replace", swap), self.assertRaises(ValueError):
            self.apply()
        self.assertEqual(manager.observe(self.app), saved)
        self.assertEqual(self.journal()[1]["state"], "blocked-unexpected-bytes")

    @unittest.skipUnless(hasattr(os, "chflags"), "macOS file flags")
    def test_file_flags_refused_before_objects_or_journal(self):
        target = self.app / manager.DIST / manager.FILES[0]
        os.chflags(target, stat.UF_HIDDEN)
        self.addCleanup(os.chflags, target, 0)
        self.prepare()
        with self.assertRaisesRegex(ValueError, "flags"):
            self.apply()
        self.assertFalse((self.state / "objects").exists())
        self.assertFalse((self.state / "transactions").exists())

    def test_lock_contention(self):
        self.prepare()
        with (
            manager.installation_lock(self.app, self.state),
            self.assertRaisesRegex(ValueError, "lock"),
        ):
            self.apply()

    def test_unsupported_modes_and_acls_refuse_before_objects(self):
        target = self.app / manager.DIST / manager.FILES[0]
        target.chmod(0o444)
        self.prepare()
        with self.assertRaises(ValueError):
            self.apply()
        self.assertFalse((self.state / "objects").exists())
        if sys.platform == "darwin":
            target.chmod(0o644)
            subprocess.run(["/bin/chmod", "+a", "everyone allow read", str(target)], check=True)
            # New binding includes the same data and supported file mode.
            self.prepare(output=self.directory / "acl-candidate")
            with self.assertRaisesRegex(ValueError, "ACL"):
                manager.apply(
                    self.app, self.directory / "acl-candidate/plan.json", self.state, self.recipes
                )
            subprocess.run(["/bin/chmod", "-N", str(target)], check=True)

    def test_write_failure_restores_prior_tuple_and_rollback_failure_is_journalled(self):
        self.prepare()
        original = manager.os.replace
        attempts = []

        def fail(source, target, **kwargs):
            if kwargs.get("dst_dir_fd") is not None and str(target) == Path(manager.FILES[1]).name:
                attempts.append(target)
                raise OSError("Synthetic replacement failure")
            return original(source, target, **kwargs)

        with patch.object(manager.os, "replace", fail), self.assertRaises(OSError):
            self.apply()
        self.assertEqual(self.journal()[1]["state"], "restored")
        self.assertEqual(
            manager.observe(self.app)["tuple"],
            {n: manager.digest(b) for n, b in self.pristine.items()},
        )

        def failure(label):
            if label == f"renamed:{manager.FILES[0]}":
                raise RuntimeError("Synthetic error")

        with (
            patch.object(
                manager, "execute_writes", side_effect=OSError("Synthetic staging failure")
            ),
            self.assertRaises(OSError),
        ):
            self.apply(failure)
        active = next(
            manager.read_json(p)
            for p in (self.state / "transactions").glob("*.json")
            if manager.read_json(p)["state"] != "restored"
        )
        self.assertEqual(active["state"], "blocked-unexpected-bytes")
        manager.restore(self.app, active["id"], self.state, registry=self.recipes)

    def test_destination_race_preserves_unexpected_bytes(self):
        self.prepare()
        target = self.app / manager.DIST / manager.FILES[1]

        def race(label):
            if label == f"intent:{manager.FILES[1]}":
                target.write_bytes(b"concurrent writer")

        with self.assertRaises(ValueError):
            self.apply(race)
        self.assertEqual(target.read_bytes(), b"concurrent writer")
        self.assertEqual(self.journal()[1]["state"], "blocked-unexpected-bytes")

    def test_remove_either_feature_from_combination_using_pristine_objects(self):
        plan = self.prepare("session-options-plus-activity")
        self.apply()
        # Complete installations can prepare a different profile using pristine objects.
        for feature in ("session-options", "activity"):
            other = self.prepare(feature, self.directory / feature)
            self.assertEqual(
                manager.verify(other, self.recipes)["payload"]["manifest"]["id"], feature
            )
        self.assertTrue(plan.exists())
        # Apply a remaining-feature profile directly from a complete combined set.
        session = self.directory / "session-options" / "plan.json"
        manager.apply(self.app, session, self.state, self.recipes)
        self.assertEqual(self.report("session-options")[1], 0)
        self.assertEqual(self.report("activity")[1], 1)
