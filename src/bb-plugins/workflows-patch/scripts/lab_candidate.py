"""Persist exact-recipe evidence for disposable patch rehearsals."""

import hashlib
import json
import os
import stat
from pathlib import Path

from bb_patch import canonical, digest, durable_json
from package_candidate import EXACT_RECIPES, _tree_digest, prepare_package


def dependency_digest(root):
    """Fingerprint retained dependencies, rejecting links outside their root."""
    root = root.resolve(strict=True)
    entries = []
    for path in sorted(root.rglob("*")):
        info = path.lstat()
        if path.is_symlink():
            target = path.resolve(strict=True)
            if not target.is_relative_to(root):
                raise ValueError("Dependency link escapes installed dependency root")
            value = ["link", os.readlink(path)]
        elif path.is_dir():
            value = ["directory", stat.S_IMODE(info.st_mode)]
        elif path.is_file():
            value = ["file", stat.S_IMODE(info.st_mode), file_digest(path)]
        else:
            raise ValueError("Unsupported dependency entry")
        entries.append([str(path.relative_to(root)), value])
    return digest(canonical(entries))


def file_digest(path):
    with path.open("rb") as source:
        return (
            hashlib.file_digest(source, "sha256").hexdigest()
            if hasattr(hashlib, "file_digest")
            else digest(source.read())
        )


def inputs(package, node):
    return {
        "node": str(node.resolve(strict=True)),
        "nodeHash": file_digest(node),
        "dependencyRoot": str(package.resolve(strict=True).parent),
        "dependencyHash": dependency_digest(package.resolve(strict=True).parent),
    }


def prepare_verified(package, output, node):
    version = json.loads((package / "package.json").read_bytes())["version"]
    if version not in EXACT_RECIPES:
        raise ValueError("No exact-release recipe for this rehearsal")
    before = inputs(package, node)
    report = prepare_package(package, output, node, "session-options-plus-activity")
    if report["status"] != "patched" or set(report["appliedPatches"]) != {
        "activity",
        "session-options",
    }:
        raise ValueError(
            "Required patch set did not pass: " + report.get("warning", report["status"])
        )
    if inputs(package, node) != before:
        raise ValueError("Runtime or dependencies changed during verification")
    payload = {
        "schema": 1,
        "scope": "disposable-only",
        "inputs": before,
        "report": report,
    }
    receipt = {**payload, "receiptId": digest(canonical(payload))}
    path = Path(report["package"]).parent / "verification.json"
    durable_json(path, receipt)
    path.chmod(0o600)
    return path


def verify_receipt(path):
    if path.is_symlink():
        raise ValueError("Symlinked verification receipt refused")
    receipt = json.loads(path.read_bytes())
    payload = {key: value for key, value in receipt.items() if key != "receiptId"}
    if (
        receipt.get("schema") != 1
        or receipt.get("scope") != "disposable-only"
        or digest(canonical(payload)) != receipt.get("receiptId")
    ):
        raise ValueError("Invalid verification receipt")
    report, runtime = receipt["report"], receipt["inputs"]
    package = Path(report["package"])
    if package.resolve(strict=True).parent != path.resolve(strict=True).parent:
        raise ValueError("Receipt does not bind this candidate directory")
    if _tree_digest(package) != report["packageTree"]:
        raise ValueError("Candidate changed after verification")
    if (
        file_digest(Path(runtime["node"])) != runtime["nodeHash"]
        or dependency_digest(Path(runtime["dependencyRoot"])) != runtime["dependencyHash"]
    ):
        raise ValueError("Runtime or dependencies changed after verification")
    for group in report["provenance"].values():
        for name, expected in group.items():
            from bb_patch import ROOT

            if file_digest(ROOT / name) != expected:
                raise ValueError("Recipe or harness changed after verification")
    return receipt


def main():
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare")
    prepare.add_argument("--package", required=True, type=Path)
    prepare.add_argument("--node", required=True, type=Path)
    prepare.add_argument("--output", required=True, type=Path)
    verify = commands.add_parser("verify")
    verify.add_argument("--receipt", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            print(
                json.dumps({"receipt": str(prepare_verified(args.package, args.output, args.node))})
            )
        else:
            print(json.dumps(verify_receipt(args.receipt)))
    except (OSError, ValueError, KeyError) as error:
        print(json.dumps({"error": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
