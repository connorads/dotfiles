#!/usr/bin/env python3
"""Admit, validate and execute reviewed Codex question-timeout patches."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

CONFIG_ROOT = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
DATA_ROOT = (
    Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "codex-question-patch"
)
MANIFEST_ROOT = CONFIG_ROOT / "codex-question-patch/manifests"


class Refusal(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise Refusal(f"cannot read {path}: {error}") from error
    if not isinstance(value, dict):
        raise Refusal(f"invalid object in {path}")
    return value


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def host_os() -> str:
    return platform.system().lower()


def host_arch() -> str:
    return platform.machine().lower()


def signature_details(binary: Path) -> str:
    process = subprocess.run(
        ["codesign", "-dvv", str(binary)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if process.returncode:
        raise Refusal(f"cannot inspect code signature for {binary}")
    return process.stdout


def verify_signature(binary: Path) -> None:
    process = subprocess.run(
        ["codesign", "--verify", "--strict", str(binary)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        check=False,
    )
    if process.returncode:
        raise Refusal(f"code signature verification failed for {binary}: {process.stdout.strip()}")


def require_manifest(version: str) -> dict[str, Any]:
    path = MANIFEST_ROOT / f"{version}.json"
    if not path.is_file():
        raise Refusal(f"no reviewed manifest for Codex {version}")
    manifest = read_json(path)
    if manifest.get("format_version") != 1 or manifest.get("codex_version") != version:
        raise Refusal(f"invalid manifest identity in {path}")
    if manifest.get("os") != host_os() or manifest.get("arch") != host_arch():
        raise Refusal(
            f"manifest supports {manifest.get('os')}/{manifest.get('arch')}, "
            f"host is {host_os()}/{host_arch()}"
        )
    return manifest


def verify_upstream(binary: Path, manifest: dict[str, Any]) -> bytes:
    try:
        data = binary.read_bytes()
    except OSError as error:
        raise Refusal(f"cannot read upstream binary {binary}: {error}") from error
    expected = manifest["upstream"]
    if len(data) != expected["size"]:
        raise Refusal(f"upstream size mismatch: expected {expected['size']}, got {len(data)}")
    digest = sha256(data)
    if digest != expected["sha256"]:
        raise Refusal(f"upstream sha256 mismatch: expected {expected['sha256']}, got {digest}")
    details = signature_details(binary)
    for item in (
        f"Identifier={expected['identifier']}",
        f"TeamIdentifier={expected['team_identifier']}",
    ):
        if item not in details:
            raise Refusal(f"upstream signature mismatch: missing {item}")
    verify_signature(binary)
    return data


def patch_bytes(data: bytes, intervention: dict[str, Any]) -> bytes:
    if intervention.get("kind") == "upstream-blocking":
        return data
    if intervention.get("kind") != "four-byte-patch":
        raise Refusal(f"unknown intervention kind: {intervention.get('kind')}")
    offset = intervention["offset"]
    before = bytes.fromhex(intervention["before_hex"])
    after = bytes.fromhex(intervention["after_hex"])
    if len(before) != 4 or len(after) != 4:
        raise Refusal("reviewed patch must replace exactly four bytes")
    start = intervention["window_start"]
    end = start + intervention["window_size"]
    if sha256(data[start:end]) != intervention["window_sha256"]:
        raise Refusal("containing instruction window mismatch")
    if data[offset : offset + 4] != before:
        raise Refusal("reviewed four-byte instruction mismatch")
    patched = data[:offset] + after + data[offset + 4 :]
    if sha256(patched) != intervention["raw_patched_sha256"]:
        raise Refusal("patched artefact sha256 mismatch before signing")
    return patched


def pending_dir(version: str) -> Path:
    return DATA_ROOT / "pending" / version


def version_dir(version: str) -> Path:
    return DATA_ROOT / "versions" / version


def command_stage(binary: Path, version: str) -> int:
    try:
        manifest = require_manifest(version)
    except Refusal as error:
        source = DATA_ROOT / "unreviewed" / version / "codex"
        source.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(binary, source)
        print(f"REVIEW REQUIRED {version}: {error}", file=sys.stderr)
        print(f"Run: codex-question-patch brief {version}", file=sys.stderr)
        return 3

    data = verify_upstream(binary, manifest)
    patched = patch_bytes(data, manifest["intervention"])
    destination = pending_dir(version)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f".{version}.", dir=destination.parent
    ) as raw_temporary:
        temporary = Path(raw_temporary)
        shutil.copy2(binary, temporary / "upstream-codex")
        candidate = temporary / "codex"
        candidate.write_bytes(patched)
        candidate.chmod(0o755)
        signing = subprocess.run(
            ["codesign", "--force", "--sign", "-", str(candidate)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )
        if signing.returncode:
            raise Refusal(f"ad-hoc signing failed: {signing.stdout.strip()}")
        verify_signature(candidate)
        receipt = {
            "format_version": 1,
            "version": version,
            "manifest_sha256": sha256((MANIFEST_ROOT / f"{version}.json").read_bytes()),
            "artefact_sha256": sha256(candidate.read_bytes()),
            "validated": False,
        }
        write_json(temporary / "receipt.json", receipt)
        if destination.exists():
            shutil.rmtree(destination)
        os.replace(temporary, destination)
    print(f"PENDING {version}: run codex-question-patch validate {version}")
    return 0


def verified_candidate(version: str, *, require_validated: bool) -> tuple[Path, dict[str, Any]]:
    directory = pending_dir(version)
    receipt = read_json(directory / "receipt.json")
    binary = directory / "codex"
    if receipt.get("version") != version:
        raise Refusal("pending receipt version mismatch")
    if require_validated and receipt.get("validated") is not True:
        raise Refusal(f"Codex {version} has not passed validation")
    digest = sha256(binary.read_bytes())
    if digest != receipt.get("artefact_sha256"):
        raise Refusal(
            f"pending artefact sha256 mismatch: expected {receipt.get('artefact_sha256')}, got {digest}"
        )
    verify_signature(binary)
    return binary, receipt


def command_validate(version: str) -> int:
    binary, receipt = verified_candidate(version, require_validated=False)
    process = subprocess.run(
        [str(binary), "--version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        timeout=15,
        check=False,
    )
    if process.returncode or version not in process.stdout:
        raise Refusal(f"version smoke check failed: {process.stdout.strip()}")
    receipt["validated"] = True
    receipt["validation"] = {
        "signature": "passed",
        "full_hash": "passed",
        "version_smoke": process.stdout.strip(),
    }
    write_json(pending_dir(version) / "receipt.json", receipt)
    print(f"VALIDATED {version}")
    return 0


def command_activate(version: str) -> int:
    binary, receipt = verified_candidate(version, require_validated=True)
    destination = version_dir(version)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{version}.{os.getpid()}.tmp")
    if temporary.exists():
        shutil.rmtree(temporary)
    shutil.copytree(pending_dir(version), temporary)
    if destination.exists():
        shutil.rmtree(destination)
    os.replace(temporary, destination)
    active_path = DATA_ROOT / "active.json"
    if active_path.exists():
        write_json(DATA_ROOT / "previous.json", read_json(active_path))
    write_json(active_path, {"version": version, "artefact_sha256": receipt["artefact_sha256"]})
    binary = destination / "codex"
    verify_signature(binary)
    print(f"ACTIVE {version}")
    return 0


def active_binary() -> Path:
    active = read_json(DATA_ROOT / "active.json")
    version = active.get("version")
    binary = version_dir(str(version)) / "codex"
    try:
        digest = sha256(binary.read_bytes())
    except OSError as error:
        raise Refusal(f"cannot read active artefact: {error}") from error
    if digest != active.get("artefact_sha256"):
        raise Refusal(
            f"active artefact sha256 mismatch: expected {active.get('artefact_sha256')}, got {digest}"
        )
    verify_signature(binary)
    return binary


def command_exec(arguments: list[str]) -> int:
    binary = active_binary()
    os.execv(binary, [str(binary), *arguments])


def command_status() -> int:
    try:
        active = read_json(DATA_ROOT / "active.json")
        print(f"ACTIVE {active['version']}")
    except Refusal:
        print("ACTIVE none")
    pending = DATA_ROOT / "pending"
    if pending.is_dir():
        for receipt_path in sorted(pending.glob("*/receipt.json")):
            receipt = read_json(receipt_path)
            state = "VALIDATED" if receipt.get("validated") else "PENDING"
            print(f"{state} {receipt.get('version')}")
    unreviewed = DATA_ROOT / "unreviewed"
    if unreviewed.is_dir():
        for path in sorted(unreviewed.iterdir()):
            print(f"REVIEW REQUIRED {path.name}")
    return 0


def command_brief(version: str) -> int:
    source = DATA_ROOT / "unreviewed" / version / "codex"
    print(
        f"Review Codex {version} at {source}. Work static-first. Locate the compiled "
        "RequestUserInputArgs.is_blocking assignment, prove a minimal patch or record "
        "that upstream is blocking, then add an exact manifest under "
        f"{MANIFEST_ROOT}. Do not activate the candidate."
    )
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    commands = result.add_subparsers(dest="command", required=True)
    stage = commands.add_parser("stage")
    stage.add_argument("binary", type=Path)
    stage.add_argument("version")
    for name in ("validate", "activate", "brief"):
        command = commands.add_parser(name)
        command.add_argument("version")
    commands.add_parser("status")
    execute = commands.add_parser("exec")
    execute.add_argument("arguments", nargs=argparse.REMAINDER)
    return result


def main() -> int:
    arguments = parser().parse_args()
    if arguments.command == "stage":
        return command_stage(arguments.binary, arguments.version)
    if arguments.command == "validate":
        return command_validate(arguments.version)
    if arguments.command == "activate":
        return command_activate(arguments.version)
    if arguments.command == "brief":
        return command_brief(arguments.version)
    if arguments.command == "status":
        return command_status()
    if arguments.command == "exec":
        values = arguments.arguments
        if values[:1] == ["--"]:
            values = values[1:]
        return command_exec(values)
    raise AssertionError(arguments.command)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (Refusal, KeyError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"codex-question-patch: REFUSED: {error}", file=sys.stderr)
        raise SystemExit(1) from error
