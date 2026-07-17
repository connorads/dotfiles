#!/usr/bin/env python3
"""Collect static metadata from a macOS binary, app bundle, or DMG.

The target is never launched. DMG mounting is opt-in, read-only, hidden from
Finder, and detached before the process exits.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


MAX_ARTIFACT_BYTES = 32 * 1024 * 1024
MAX_INVENTORY_ENTRIES = 10_000


class TriageError(RuntimeError):
    """A fatal error that prevents safe inspection."""


class Triage:
    def __init__(self, target: Path, out_dir: Path, mount_requested: bool) -> None:
        self.target = target
        self.out_dir = out_dir
        self.metadata: dict[str, Any] = {
            "target": str(target),
            "out_dir": str(out_dir),
            "target_executed": False,
            "mount_requested": mount_requested,
            "detached": None,
            "commands": [],
        }

    def save_metadata(self) -> None:
        (self.out_dir / "triage-metadata.json").write_text(
            json.dumps(self.metadata, indent=2) + "\n",
            encoding="utf-8",
        )

    def write_text(self, name: str, text: str) -> Path:
        path = self.out_dir / name
        path.write_text(text, encoding="utf-8", errors="replace")
        return path

    def run(
        self,
        label: str,
        command: list[str],
        *,
        timeout: int = 120,
        stdin_path: Path | None = None,
    ) -> dict[str, Any]:
        output_path = self.out_dir / f"{label}.txt"
        record: dict[str, Any] = {
            "label": label,
            "command": command,
            "output": str(output_path),
            "returncode": None,
            "duration_seconds": None,
            "error": None,
            "truncated": False,
        }
        started = time.monotonic()

        try:
            with output_path.open("wb") as output:
                stdin = stdin_path.open("rb") if stdin_path else subprocess.DEVNULL
                try:
                    completed = subprocess.run(
                        command,
                        stdin=stdin,
                        stdout=output,
                        stderr=subprocess.STDOUT,
                        timeout=timeout,
                        check=False,
                    )
                finally:
                    if stdin_path:
                        stdin.close()
            record["returncode"] = completed.returncode
        except (OSError, subprocess.TimeoutExpired) as exc:
            record["error"] = str(exc)

        if output_path.exists() and output_path.stat().st_size > MAX_ARTIFACT_BYTES:
            with output_path.open("r+b") as output:
                output.truncate(MAX_ARTIFACT_BYTES)
            record["truncated"] = True

        record["duration_seconds"] = round(time.monotonic() - started, 3)
        self.metadata["commands"].append(record)
        return record

    def run_plist(
        self,
        label: str,
        command: list[str],
        *,
        timeout: int = 120,
    ) -> tuple[dict[str, Any], bytes]:
        output_path = self.out_dir / f"{label}.plist"
        error_path = self.out_dir / f"{label}-stderr.txt"
        record: dict[str, Any] = {
            "label": label,
            "command": command,
            "output": str(output_path),
            "stderr": str(error_path),
            "returncode": None,
            "duration_seconds": None,
            "error": None,
        }
        started = time.monotonic()
        data = b""

        try:
            completed = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                check=False,
            )
            data = completed.stdout[:MAX_ARTIFACT_BYTES]
            output_path.write_bytes(data)
            error_path.write_bytes(completed.stderr[:MAX_ARTIFACT_BYTES])
            record["returncode"] = completed.returncode
        except (OSError, subprocess.TimeoutExpired) as exc:
            record["error"] = str(exc)
            output_path.write_bytes(data)
            error_path.write_text(str(exc), encoding="utf-8")

        record["duration_seconds"] = round(time.monotonic() - started, 3)
        self.metadata["commands"].append(record)
        return record, data


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def available(command: str) -> str | None:
    return shutil.which(command)


def require(command: str) -> str:
    path = available(command)
    if not path:
        raise TriageError(f"required command is unavailable: {command}")
    return path


def regular_file_without_following(path: Path) -> bool:
    try:
        return stat.S_ISREG(path.lstat().st_mode) and not path.is_symlink()
    except OSError:
        return False


def regular_descendant_without_symlinks(root: Path, path: Path) -> bool:
    try:
        relative = path.relative_to(root)
    except ValueError:
        return False
    if ".." in relative.parts:
        return False

    current = root
    try:
        for part in relative.parts:
            current /= part
            mode = current.lstat().st_mode
            if stat.S_ISLNK(mode):
                return False
        return stat.S_ISREG(mode)
    except OSError:
        return False


def ensure_bundle_symlinks_stay_inside(app: Path) -> None:
    root = app.resolve(strict=True)
    for current, directories, files in os.walk(app, followlinks=False):
        current_path = Path(current)
        for name in directories + files:
            path = current_path / name
            if not path.is_symlink():
                continue
            link = Path(os.readlink(path))
            destination = link if link.is_absolute() else path.parent / link
            if not destination.resolve(strict=False).is_relative_to(root):
                raise TriageError(f"bundle symlink escapes the app: {path} -> {link}")


def inventory_bundle(app: Path) -> tuple[list[str], list[Path]]:
    rows: list[str] = []
    asset_catalogues: list[Path] = []

    for root, directories, files in os.walk(app, followlinks=False):
        root_path = Path(root)
        for name in sorted(directories + files):
            path = root_path / name
            relative = path.relative_to(app)
            try:
                mode = path.lstat().st_mode
            except OSError as exc:
                rows.append(f"unreadable\t{relative}\t{exc}")
                continue

            if stat.S_ISLNK(mode):
                kind = "symlink"
            elif stat.S_ISDIR(mode):
                kind = "directory"
            elif stat.S_ISREG(mode):
                kind = "file"
            else:
                kind = "other"
            rows.append(f"{kind}\t{relative}")

            if kind == "file" and name == "Assets.car":
                asset_catalogues.append(path)
            if len(rows) >= MAX_INVENTORY_ENTRIES:
                rows.append("truncated\tinventory limit reached")
                directories[:] = []
                return rows, asset_catalogues

    return rows, asset_catalogues


def inspect_binary(triage: Triage, binary: Path, prefix: str) -> None:
    triage.write_text(f"{prefix}-sha256.txt", f"{sha256(binary)}  {binary}\n")

    commands: list[tuple[str, list[str], int]] = []
    if command := available("file"):
        commands.append((f"{prefix}-file", [command, str(binary)], 60))
    if command := available("lipo"):
        commands.append((f"{prefix}-architectures", [command, "-archs", str(binary)], 60))
    if available("xcrun"):
        commands.extend(
            [
                (
                    f"{prefix}-uuids",
                    ["xcrun", "dwarfdump", "--uuid", str(binary)],
                    60,
                ),
                (
                    f"{prefix}-build",
                    ["xcrun", "vtool", "-show-build", str(binary)],
                    60,
                ),
            ]
        )
    if command := available("otool"):
        commands.extend(
            [
                (f"{prefix}-headers", [command, "-hv", str(binary)], 120),
                (f"{prefix}-libraries", [command, "-L", str(binary)], 120),
                (f"{prefix}-load-commands", [command, "-l", str(binary)], 180),
            ]
        )
    if command := available("strings"):
        commands.append((f"{prefix}-strings", [command, "-a", str(binary)], 300))

    for label, command, timeout in commands:
        triage.run(label, command, timeout=timeout)

    apple_nm = Path("/usr/bin/nm")
    if apple_nm.is_file():
        nm_record = triage.run(
            f"{prefix}-symbols",
            [str(apple_nm), "-a", str(binary)],
            timeout=300,
        )
        nm_output = Path(nm_record["output"])
        if available("xcrun") and nm_output.is_file():
            triage.run(
                f"{prefix}-swift-symbols",
                ["xcrun", "swift-demangle"],
                timeout=300,
                stdin_path=nm_output,
            )

    dyld_info = available("dyld_info")
    arch_output = triage.out_dir / f"{prefix}-architectures.txt"
    if dyld_info and arch_output.is_file():
        words = arch_output.read_text(encoding="utf-8", errors="replace").split()
        architectures = [
            word for word in words if word in {"arm64", "arm64e", "x86_64", "i386"}
        ]
        for architecture in architectures[:4]:
            triage.run(
                f"{prefix}-objc-{architecture}",
                [dyld_info, "-arch", architecture, "-objc", str(binary)],
                timeout=300,
            )


def inspect_app(triage: Triage, app: Path) -> None:
    if app.is_symlink():
        raise TriageError(f"refusing to follow app bundle symlink: {app}")
    ensure_bundle_symlinks_stay_inside(app)

    info_plist = app / "Contents" / "Info.plist"
    if not regular_descendant_without_symlinks(app, info_plist):
        raise TriageError(f"app has no regular Contents/Info.plist: {app}")

    plutil = require("plutil")
    triage.run("app-info-plist", [plutil, "-p", str(info_plist)], timeout=60)

    try:
        with info_plist.open("rb") as source:
            info = plistlib.load(source)
    except (OSError, plistlib.InvalidFileException) as exc:
        raise TriageError(f"cannot parse {info_plist}: {exc}") from exc

    selected_info = {
        key: info.get(key)
        for key in [
            "CFBundleIdentifier",
            "CFBundleExecutable",
            "CFBundleShortVersionString",
            "CFBundleVersion",
            "LSMinimumSystemVersion",
        ]
    }
    triage.write_text("app-summary.json", json.dumps(selected_info, indent=2) + "\n")

    inventory, asset_catalogues = inventory_bundle(app)
    triage.write_text("app-inventory.txt", "\n".join(inventory) + "\n")
    triage.metadata["asset_catalogues"] = [
        str(path.relative_to(app)) for path in asset_catalogues
    ]

    if codesign := available("codesign"):
        triage.run(
            "app-codesign-display",
            [codesign, "-d", "--verbose=4", str(app)],
            timeout=120,
        )
        triage.run(
            "app-codesign-entitlements",
            [codesign, "-d", "--entitlements", ":-", str(app)],
            timeout=120,
        )
        triage.run(
            "app-codesign-verify",
            [codesign, "--verify", "--deep", "--strict", "--verbose=4", str(app)],
            timeout=180,
        )
    if spctl := available("spctl"):
        triage.run(
            "app-policy-assessment",
            [spctl, "-a", "-vvv", "-t", "execute", str(app)],
            timeout=180,
        )

    executable = info.get("CFBundleExecutable")
    if not isinstance(executable, str) or not executable:
        raise TriageError(f"CFBundleExecutable is missing or invalid in {info_plist}")
    if Path(executable).name != executable:
        raise TriageError(f"CFBundleExecutable is not a basename: {executable}")

    main_binary = app / "Contents" / "MacOS" / executable
    if not regular_descendant_without_symlinks(app, main_binary):
        raise TriageError(f"refusing non-regular or symlinked main executable: {main_binary}")
    inspect_binary(triage, main_binary, "main-binary")


def find_app_bundles(root: Path) -> list[Path]:
    apps: list[Path] = []
    for current, directories, _files in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in list(directories):
            path = current_path / name
            if name.endswith(".app") and not path.is_symlink():
                apps.append(path)
                directories.remove(name)
        if len(apps) >= 20:
            break
    return sorted(apps)


def inspect_dmg(triage: Triage, allow_mount: bool) -> None:
    hdiutil = require("hdiutil")
    triage.write_text("target-sha256.txt", f"{sha256(triage.target)}  {triage.target}\n")
    triage.run_plist(
        "dmg-imageinfo",
        [hdiutil, "imageinfo", "-plist", str(triage.target)],
        timeout=180,
    )
    verify = triage.run(
        "dmg-verify",
        [hdiutil, "verify", str(triage.target)],
        timeout=300,
    )
    if verify["returncode"] != 0:
        raise TriageError("DMG verification failed; refusing to mount it")
    if not allow_mount:
        return

    mountpoint = triage.out_dir / "mount"
    mountpoint.mkdir()
    attached = False

    try:
        attach, data = triage.run_plist(
            "dmg-attach",
            [
                hdiutil,
                "attach",
                "-readonly",
                "-nobrowse",
                "-noautoopen",
                "-mountpoint",
                str(mountpoint),
                "-plist",
                str(triage.target),
            ],
            timeout=300,
        )
        if attach["returncode"] != 0:
            raise TriageError("read-only DMG attach failed")
        attached = True

        try:
            attach_info = plistlib.loads(data)
        except plistlib.InvalidFileException as exc:
            raise TriageError(f"cannot parse hdiutil attach output: {exc}") from exc
        triage.metadata["mounted_entities"] = attach_info.get("system-entities", [])

        apps = find_app_bundles(mountpoint)
        triage.metadata["discovered_apps"] = [str(path.relative_to(mountpoint)) for path in apps]
        if not apps:
            raise TriageError("mounted DMG contains no discoverable app bundle")
        inspect_app(triage, apps[0])
    finally:
        if attached:
            detach = triage.run(
                "dmg-detach",
                [hdiutil, "detach", str(mountpoint)],
                timeout=180,
            )
            triage.metadata["detached"] = detach["returncode"] == 0
            if detach["returncode"] != 0:
                raise TriageError(f"failed to detach DMG mountpoint: {mountpoint}")
        try:
            mountpoint.rmdir()
        except OSError:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Statically inspect a macOS binary, app bundle, or DMG.",
    )
    parser.add_argument("target", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--allow-mount",
        action="store_true",
        help="mount a DMG read-only, hidden, and without Finder auto-open",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    target = args.target.expanduser().absolute()
    if target.is_symlink():
        print(f"error: refusing to follow target symlink: {target}", file=sys.stderr)
        return 2
    if not target.exists():
        print(f"error: target does not exist: {target}", file=sys.stderr)
        return 2
    if sys.platform != "darwin":
        print("error: macOS triage requires Darwin and Apple command-line tools", file=sys.stderr)
        return 2

    stamp = time.strftime("%Y%m%d-%H%M%S")
    out_dir = args.out or Path("/tmp") / f"macos-re-{target.stem}-{stamp}"
    out_dir = out_dir.expanduser().absolute()
    if target.is_dir() and (out_dir == target or target in out_dir.parents):
        print("error: output directory must be outside the target app", file=sys.stderr)
        return 2
    out_dir.mkdir(parents=True, exist_ok=False)
    triage = Triage(target, out_dir, args.allow_mount)

    result = 0
    try:
        if target.is_dir() and target.name.endswith(".app"):
            inspect_app(triage, target)
        elif regular_file_without_following(target) and target.suffix.lower() == ".dmg":
            inspect_dmg(triage, args.allow_mount)
        elif regular_file_without_following(target):
            triage.write_text("target-sha256.txt", f"{sha256(target)}  {target}\n")
            inspect_binary(triage, target, "binary")
        else:
            raise TriageError(f"unsupported target shape: {target}")
    except TriageError as exc:
        triage.metadata["fatal_error"] = str(exc)
        print(f"error: {exc}", file=sys.stderr)
        result = 1
    finally:
        triage.save_metadata()

    print(out_dir)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
