#!/usr/bin/env python3
"""Preview or apply a reviewed snapshot of alchemy-run/alchemy documentation."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path


DEFAULT_REPO = "https://github.com/alchemy-run/alchemy.git"
SUBTREE = Path("website/src/content/docs")
EXCLUDED = ("blog",)
SUPPORTED_SUFFIXES = {".md", ".mdx"}
SUMMARY_LIMIT = 20


class UpdateError(RuntimeError):
    pass


@dataclass(frozen=True)
class Diff:
    added: tuple[str, ...]
    changed: tuple[str, ...]
    removed: tuple[str, ...]

    @property
    def has_changes(self) -> bool:
        return bool(self.added or self.changed or self.removed)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Preview or apply the vendored Alchemy documentation snapshot."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--apply", action="store_true", help="apply the validated snapshot"
    )
    mode.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero when the snapshot has drifted",
    )
    parser.add_argument(
        "--rev", help="upstream revision, tag, or commit (default: main)"
    )
    parser.add_argument(
        "--repo", default=DEFAULT_REPO, help="upstream Git URL or local path"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="allow --apply to replace locally modified generated references",
    )
    args = parser.parse_args()
    if args.force and not args.apply:
        parser.error("--force is only valid with --apply")
    return args


def run_git(*args: str | Path, cwd: Path | None = None) -> str:
    command = ["git", *(str(arg) for arg in args)]
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            text=True,
            capture_output=True,
            check=False,
        )
    except FileNotFoundError as error:
        raise UpdateError("git is required but was not found on PATH") from error
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise UpdateError(f"git command failed: {' '.join(command)}\n{detail}")
    return result.stdout.strip()


def checkout(repo: str, revision: str | None, destination: Path) -> str:
    run_git(
        "clone", "--depth", "1", "--filter=blob:none", "--sparse", repo, destination
    )
    if revision:
        run_git("fetch", "--depth", "1", "origin", revision, cwd=destination)
        run_git("checkout", "--detach", "FETCH_HEAD", cwd=destination)
    run_git("sparse-checkout", "set", SUBTREE, cwd=destination)
    return run_git("rev-parse", "HEAD", cwd=destination)


def validate_document(path: Path, relative: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise UpdateError(f"{relative}: documentation is not UTF-8") from error
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise UpdateError(f"{relative}: missing opening frontmatter delimiter")
    try:
        end = lines.index("---", 1)
    except ValueError as error:
        raise UpdateError(f"{relative}: unclosed frontmatter") from error
    if not any(
        line.startswith("title:") and line.removeprefix("title:").strip()
        for line in lines[1:end]
    ):
        raise UpdateError(f"{relative}: frontmatter has no title")


def build_candidate(source: Path, output: Path, repo: str, revision: str) -> int:
    docs = source / SUBTREE
    if not docs.is_dir():
        raise UpdateError(f"upstream subtree is missing: {SUBTREE}")
    output.mkdir()
    seen: dict[str, Path] = {}
    count = 0

    for current, directories, filenames in os.walk(docs, followlinks=False):
        current_path = Path(current)
        for directory in tuple(directories):
            candidate = current_path / directory
            if candidate.is_symlink():
                raise UpdateError(
                    f"symlinked directory is not allowed: {candidate.relative_to(docs)}"
                )
        for filename in sorted(filenames):
            source_file = current_path / filename
            relative = source_file.relative_to(docs)
            if relative.parts[0] in EXCLUDED:
                continue
            if source_file.is_symlink():
                raise UpdateError(f"symlinked file is not allowed: {relative}")
            if source_file.suffix not in SUPPORTED_SUFFIXES:
                raise UpdateError(f"unsupported documentation file: {relative}")
            validate_document(source_file, relative)
            flattened = relative.as_posix().replace("/", "--")
            if previous := seen.get(flattened):
                raise UpdateError(
                    f"flattened path collision: {previous} and {relative} -> {flattened}"
                )
            seen[flattened] = relative
            shutil.copyfile(source_file, output / flattened)
            count += 1

    if count == 0:
        raise UpdateError("upstream documentation snapshot is empty")
    provenance = {
        "repository": repo,
        "revision": revision,
        "subtree": SUBTREE.as_posix(),
        "excluded": list(EXCLUDED),
        "path_encoding": "slash-to-double-hyphen",
        "file_count": count,
    }
    (output / "upstream.json").write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return count


def files(root: Path) -> dict[str, bytes]:
    if not root.is_dir():
        return {}
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def compare(current: Path, candidate: Path) -> Diff:
    old = files(current)
    new = files(candidate)
    return Diff(
        added=tuple(sorted(new.keys() - old.keys())),
        changed=tuple(
            sorted(path for path in new.keys() & old.keys() if new[path] != old[path])
        ),
        removed=tuple(sorted(old.keys() - new.keys())),
    )


def print_summary(diff: Diff, old_revision: str | None, new_revision: str) -> None:
    print(f"old revision: {old_revision or '(none)'}")
    print(f"new revision: {new_revision}")
    for label, paths in (
        ("added", diff.added),
        ("changed", diff.changed),
        ("removed", diff.removed),
    ):
        print(f"{label}: {len(paths)}")
        for path in paths[:SUMMARY_LIMIT]:
            print(f"  {path}")
        if len(paths) > SUMMARY_LIMIT:
            print(f"  ... {len(paths) - SUMMARY_LIMIT} more")


def existing_revision(references: Path) -> str | None:
    provenance = references / "upstream.json"
    if not provenance.is_file():
        return None
    try:
        value = json.loads(provenance.read_text(encoding="utf-8")).get("revision")
    except (json.JSONDecodeError, OSError):
        return "(unreadable)"
    return value if isinstance(value, str) else "(missing)"


def status_output(skill_root: Path) -> str:
    git_root = subprocess.run(
        ["git", "-C", str(skill_root), "rev-parse", "--show-toplevel"],
        text=True,
        capture_output=True,
        check=False,
    )
    if git_root.returncode == 0:
        return subprocess.run(
            ["git", "-C", str(skill_root), "status", "--porcelain", "--", "references"],
            text=True,
            capture_output=True,
            check=False,
        ).stdout.strip()
    dotfiles = shutil.which("dotfiles")
    if dotfiles:
        return subprocess.run(
            [dotfiles, "status", "--porcelain", "--", str(skill_root / "references")],
            text=True,
            capture_output=True,
            check=False,
        ).stdout.strip()
    return ""


def apply_candidate(skill_root: Path, candidate: Path, force: bool) -> None:
    destination = skill_root / "references"
    if destination.exists() and not force and status_output(skill_root):
        raise UpdateError(
            "generated references have local changes; review them or rerun with --force"
        )

    nonce = uuid.uuid4().hex
    staged = skill_root / f".references-new-{nonce}"
    backup = skill_root / f".references-old-{nonce}"
    shutil.copytree(candidate, staged)
    moved_old = False
    try:
        if destination.exists():
            destination.rename(backup)
            moved_old = True
        staged.rename(destination)
    except Exception:
        if moved_old and backup.exists() and not destination.exists():
            backup.rename(destination)
        raise
    finally:
        if staged.exists():
            shutil.rmtree(staged)
    if backup.exists():
        shutil.rmtree(backup)


def main() -> int:
    args = parse_args()
    skill_root = Path(__file__).resolve().parents[1]
    references = skill_root / "references"
    try:
        with tempfile.TemporaryDirectory(prefix="alchemy-docs-") as temporary:
            temporary_root = Path(temporary)
            source = temporary_root / "source"
            candidate = temporary_root / "references"
            revision = checkout(args.repo, args.rev, source)
            count = build_candidate(source, candidate, args.repo, revision)
            diff = compare(references, candidate)
            print_summary(diff, existing_revision(references), revision)
            print(f"files: {count}")
            if args.apply:
                if diff.has_changes:
                    apply_candidate(skill_root, candidate, args.force)
                    print("applied: yes")
                else:
                    print("applied: already current")
            elif not args.check:
                print("preview only; rerun with --apply to update references")
            if args.check and diff.has_changes:
                return 1
            return 0
    except UpdateError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
