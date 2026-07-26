#!/usr/bin/env python3
"""Black-box tests for the Alchemy reference CLIs."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]


class CliTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.skill = self.root / "skill"
        (self.skill / "scripts").mkdir(parents=True)
        for name in ("search.py", "update.py"):
            source = SKILL_ROOT / "scripts" / name
            if source.exists():
                shutil.copyfile(source, self.skill / "scripts" / name)

    def run_cli(
        self, script: str, *args: str, check: bool = False
    ) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            ["python3", str(self.skill / "scripts" / script), *args],
            cwd=self.skill,
            text=True,
            capture_output=True,
            check=False,
        )
        if check and result.returncode != 0:
            self.fail(
                f"{script} exited {result.returncode}\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        return result

    def write_doc(
        self,
        repo: Path,
        relative: str,
        title: str,
        description: str,
        body: str,
    ) -> bytes:
        content = (
            f"---\ntitle: {title}\ndescription: {description}\n---\n\n{body}\n"
        ).encode()
        target = repo / "website/src/content/docs" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return content

    def make_repo(self) -> Path:
        repo = self.root / "upstream"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", repo], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                repo,
                "config",
                "user.email",
                "test@users.noreply.github.com",
            ],
            check=True,
        )
        subprocess.run(["git", "-C", repo, "config", "user.name", "Test"], check=True)
        return repo

    def commit_repo(self, repo: Path, message: str = "fixture") -> str:
        subprocess.run(["git", "-C", repo, "add", "."], check=True)
        subprocess.run(["git", "-C", repo, "commit", "-qm", message], check=True)
        return subprocess.run(
            ["git", "-C", repo, "rev-parse", "HEAD"],
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()


class UpdateCliTests(CliTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.repo = self.make_repo()
        self.worker_bytes = self.write_doc(
            self.repo,
            "cloudflare/compute/workers.mdx",
            "Workers",
            "Deploy Cloudflare Workers.",
            "## Bindings\n\nConfigure bindings.",
        )
        self.write_doc(
            self.repo,
            "blog/release.md",
            "Release",
            "Historical release notes.",
            "Blog content.",
        )
        self.initial_commit = self.commit_repo(self.repo)

    def test_preview_reports_drift_without_mutating(self) -> None:
        result = self.run_cli("update.py", "--repo", str(self.repo), check=True)

        self.assertIn("added: 2", result.stdout)
        self.assertFalse((self.skill / "references").exists())

    def test_apply_flattens_paths_excludes_blog_and_preserves_bytes(self) -> None:
        self.run_cli("update.py", "--repo", str(self.repo), "--apply", check=True)

        worker = self.skill / "references/cloudflare--compute--workers.mdx"
        self.assertEqual(self.worker_bytes, worker.read_bytes())
        self.assertFalse((self.skill / "references/blog--release.md").exists())
        provenance = json.loads((self.skill / "references/upstream.json").read_text())
        self.assertEqual(self.initial_commit, provenance["revision"])
        self.assertEqual(1, provenance["file_count"])
        self.assertEqual(["blog"], provenance["excluded"])
        self.assertNotIn("generated_at", provenance)

    def test_check_exits_one_only_when_snapshot_drifted(self) -> None:
        self.run_cli("update.py", "--repo", str(self.repo), "--apply", check=True)
        clean = self.run_cli("update.py", "--repo", str(self.repo), "--check")
        self.assertEqual(0, clean.returncode)

        self.write_doc(
            self.repo,
            "state-store/index.mdx",
            "State store",
            "Configure state storage.",
            "State details.",
        )
        self.commit_repo(self.repo, "add state docs")
        drifted = self.run_cli("update.py", "--repo", str(self.repo), "--check")
        self.assertEqual(1, drifted.returncode)
        self.assertIn("added: 1", drifted.stdout)

    def test_apply_removes_deleted_upstream_files(self) -> None:
        self.run_cli("update.py", "--repo", str(self.repo), "--apply", check=True)
        (self.repo / "website/src/content/docs/cloudflare/compute/workers.mdx").unlink()
        self.write_doc(
            self.repo,
            "cli/deploy.mdx",
            "Deploy",
            "Deploy a stack.",
            "Deploy details.",
        )
        self.commit_repo(self.repo, "replace docs")

        result = self.run_cli(
            "update.py", "--repo", str(self.repo), "--apply", check=True
        )

        self.assertIn("removed: 1", result.stdout)
        self.assertFalse(
            (self.skill / "references/cloudflare--compute--workers.mdx").exists()
        )
        self.assertTrue((self.skill / "references/cli--deploy.mdx").exists())

    def test_invalid_candidate_leaves_existing_snapshot_untouched(self) -> None:
        self.run_cli("update.py", "--repo", str(self.repo), "--apply", check=True)
        before = directory_hash(self.skill / "references")
        bad = self.repo / "website/src/content/docs/invalid.mdx"
        bad.write_text("No frontmatter\n")
        self.commit_repo(self.repo, "invalid docs")

        result = self.run_cli("update.py", "--repo", str(self.repo), "--apply")

        self.assertNotEqual(0, result.returncode)
        self.assertIn("frontmatter", result.stderr.lower())
        self.assertEqual(before, directory_hash(self.skill / "references"))

    def test_flattened_name_collision_is_rejected(self) -> None:
        self.write_doc(
            self.repo,
            "cloudflare--compute/workers.mdx",
            "Collision",
            "Collides after flattening.",
            "Collision.",
        )
        self.commit_repo(self.repo, "collision")

        result = self.run_cli("update.py", "--repo", str(self.repo))

        self.assertNotEqual(0, result.returncode)
        self.assertIn("collision", result.stderr.lower())

    def test_dirty_generated_references_require_force(self) -> None:
        subprocess.run(["git", "init", "-q", self.skill], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                self.skill,
                "config",
                "user.email",
                "test@users.noreply.github.com",
            ],
            check=True,
        )
        subprocess.run(
            ["git", "-C", self.skill, "config", "user.name", "Test"], check=True
        )
        self.run_cli("update.py", "--repo", str(self.repo), "--apply", check=True)
        subprocess.run(["git", "-C", self.skill, "add", "."], check=True)
        subprocess.run(
            ["git", "-C", self.skill, "commit", "-qm", "snapshot"], check=True
        )
        reference = self.skill / "references/cloudflare--compute--workers.mdx"
        reference.write_text(reference.read_text() + "\nlocal edit\n")

        blocked = self.run_cli("update.py", "--repo", str(self.repo), "--apply")
        self.assertNotEqual(0, blocked.returncode)
        self.assertIn("local changes", blocked.stderr.lower())

        forced = self.run_cli(
            "update.py", "--repo", str(self.repo), "--apply", "--force"
        )
        self.assertEqual(0, forced.returncode, forced.stderr)
        self.assertEqual(self.worker_bytes, reference.read_bytes())


class SearchCliTests(CliTestCase):
    def setUp(self) -> None:
        super().setUp()
        refs = self.skill / "references"
        refs.mkdir()
        (refs / "cloudflare--compute--durable-objects.mdx").write_text(
            """---
title: Durable Objects
description: Model coordinated Cloudflare state.
---

## Migrations

Move Durable Object classes safely.

```md
## Not a real heading
```
"""
        )
        (refs / "cloudflare--data--d1.mdx").write_text(
            """---
title: D1
description: Deploy a Cloudflare SQL database.
---

## Durable Object comparison

Body mentions migrations.
"""
        )
        (refs / "aws--compute--lambda.mdx").write_text(
            """---
title: Lambda
description: Deploy AWS compute functions.
---

Durable wording appears incidentally.
"""
        )

    def test_title_and_path_rank_above_incidental_body_matches(self) -> None:
        result = self.run_cli("search.py", "durable", "migrations", check=True)

        paths = [
            line.strip()
            for line in result.stdout.splitlines()
            if line.startswith("  references/")
        ]
        self.assertEqual(
            "references/cloudflare--compute--durable-objects.mdx", paths[0]
        )
        self.assertIn("Migrations", result.stdout)
        self.assertNotIn("Not a real heading", result.stdout)

    def test_area_and_limit_bound_results(self) -> None:
        result = self.run_cli(
            "search.py", "deploy", "--area", "cloudflare", "--limit", "1", check=True
        )

        self.assertIn("references/cloudflare--data--d1.mdx", result.stdout)
        self.assertNotIn("references/aws--compute--lambda.mdx", result.stdout)
        self.assertEqual(1, result.stdout.count("\n  references/"))

    def test_no_matches_is_actionable(self) -> None:
        result = self.run_cli("search.py", "planetscale")

        self.assertEqual(1, result.returncode)
        self.assertIn("No matching Alchemy references", result.stderr)


def directory_hash(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


if __name__ == "__main__":
    unittest.main()
