"""Prepare a private server package without modifying its installed source."""

import json
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path

from adapters import bb_0_48_1
from adapters.bb_0_47_1 import transform
from bb_patch import FILES, ROOT, SETS, digest

EXACT_RECIPES = {
    "0.48.1": {
        "module": bb_0_48_1,
        "pristine": {
            "start-server.js": "41ffbb6d40eafb1253242e529b1032a7043d29e0cf0eb1c03d6d3c11e2c0a1d7",
            "builtin-plugins/workflows/dist/server.js": "013bd3bb37daf4b682f408dcff633dfec1ae49a851f72aab2fe1f5b40381341b",
        },
        "recipe": ("scripts/adapters/bb_0_47_1.py", "scripts/adapters/bb_0_48_1.py"),
        "harnesses": {"activity": "scripts/test-activity-0.48.1.mjs"},
    },
}
DEFAULT_HARNESSES = {
    "activity": "scripts/test-activity.mjs",
    "session-options": "scripts/test-bundle.mjs",
}


def _paths(package, output, node):
    for path in (package, output, node):
        if not path.is_absolute() or ".." in path.parts:
            raise ValueError("Absolute paths without traversal are required")
    package = package.resolve(strict=True)
    node = node.resolve(strict=True)
    if not package.is_dir() or not node.is_file():
        raise ValueError("Package directory and Node executable are required")
    if output.exists() or output.is_symlink():
        raise ValueError("Output must be fresh")
    output = output.resolve()
    if output.is_relative_to(package) or package.is_relative_to(output):
        raise ValueError("Output and package must not overlap")
    for name in ("package.json", "dist/bb-app.js"):
        if not (package / name).is_file():
            raise ValueError(f"Missing package file: {name}")
    for name in ("server/dist", "app/dist"):
        if not (package / name).is_dir():
            raise ValueError(f"Missing package directory: {name}")
    return package, output, node


def _optional_bytes(path):
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def _fingerprint(data):
    return digest(data) if data is not None else None


def _tree_digest(root):
    entries = []
    for path in (root, *sorted(root.rglob("*"))):
        info = path.lstat()
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError(f"Unsupported package tree entry: {path}")
        entries.append(
            [
                str(path.relative_to(root)),
                "directory" if path.is_dir() else "file",
                stat.S_IMODE(info.st_mode),
                digest(path.read_bytes()) if path.is_file() else None,
            ]
        )
    return digest(json.dumps(entries).encode())


def _run(node, arguments):
    result = subprocess.run(
        [str(node), *map(str, arguments)], capture_output=True, text=True, timeout=60
    )
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise ValueError(f"Check failed ({' '.join(map(str, arguments))}): {detail}")


def _check_candidate(directory, node, patches, *, harnesses):
    for name in FILES:
        if name.endswith(".js"):
            _run(node, ["--check", directory / name])
    for patch in patches:
        if patch == "activity":
            arguments = [
                ROOT / harnesses[patch],
                directory / FILES[0],
                directory / FILES[1],
            ]
        else:
            arguments = [
                ROOT / harnesses[patch],
                directory / FILES[1],
                directory / "session.mjs",
            ]
        _run(node, arguments)


def _prepare_fresh(package: Path, output: Path, node: Path, set_id: str):
    """Copy a package, then publish each feature that passes its offline checks."""
    if set_id not in SETS:
        raise ValueError(f"Unknown patch set: {set_id}")
    package, output, node = _paths(package, output, node)
    metadata = json.loads((package / "package.json").read_bytes())
    version = metadata["version"]
    if not isinstance(version, str):
        raise ValueError("Package version must be a string")
    pristine = {name: _optional_bytes(package / "server/dist" / name) for name in FILES}
    recipe = EXACT_RECIPES.get(version)
    adapt = recipe["module"].transform if recipe else lambda *args: transform(*args)
    harnesses = recipe["harnesses"] if recipe else DEFAULT_HARNESSES
    adapter_paths = recipe["recipe"] if recipe else ("scripts/adapters/bb_0_47_1.py",)
    recipe_paths = [
        Path(__file__).resolve(),
        ROOT / "scripts/bb_patch.py",
        *(ROOT / name for name in adapter_paths),
    ]
    harness_paths = [ROOT / name for name in harnesses.values()]
    provenance = {
        "recipe": {str(path.relative_to(ROOT)): digest(path.read_bytes()) for path in recipe_paths},
        "tests": {str(path.relative_to(ROOT)): digest(path.read_bytes()) for path in harness_paths},
    }
    output.mkdir(parents=True)
    target = output / "package"
    # Dereference package links so writing the copy cannot reach installed bytes.
    shutil.copytree(package, target, symlinks=False)
    (output / "node_modules").symlink_to(package.parent, target_is_directory=True)
    copied = {name: _optional_bytes(target / "server/dist" / name) for name in FILES}
    if copied != pristine:
        raise ValueError("Source guarded files changed during copying")
    report = {
        "package": str(target),
        "version": version,
        "status": "stock",
        "requestedSet": set_id,
        "hashes": {"before": {name: _fingerprint(data) for name, data in pristine.items()}},
        "provenance": provenance,
        "sourceTree": _tree_digest(target),
    }
    missing = [name for name, data in pristine.items() if data is None]
    unrecognised = recipe and any(
        _fingerprint(pristine[name]) != expected for name, expected in recipe["pristine"].items()
    )
    if missing or unrecognised:
        warning = (
            f"Unrecognised {version} input bytes"
            if unrecognised
            else f"Patch targets missing: {', '.join(missing)}"
        )
        report.update(
            appliedPatches=[],
            failedPatches={patch: warning for patch in SETS[set_id]},
            warning=warning,
        )
        report["hashes"]["after"] = dict(report["hashes"]["before"])
        report["packageTree"] = report["sourceTree"]
        return report
    candidate = dict(pristine)
    report["appliedPatches"] = []
    report["failedPatches"] = {}
    with tempfile.TemporaryDirectory(prefix="bb-package-check-", dir=output) as temporary:
        for patch in SETS[set_id]:
            directory = Path(temporary) / patch
            # Each feature transforms the last accepted bytes. Rejected changes
            # never enter the package or the next feature's input.
            try:
                proposed = {name: adapt(patch, name, data) for name, data in candidate.items()}
            except (ValueError, UnicodeError) as error:
                report["failedPatches"][patch] = f"Patch incompatible: {error}"
                continue
            # Filesystem failures remain hard errors rather than compatibility results.
            for name, data in proposed.items():
                path = directory / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            for name in FILES[:2]:
                path = directory / "pristine" / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(pristine[name])
            try:
                _check_candidate(directory, node, [patch], harnesses=harnesses)
            except (ValueError, subprocess.SubprocessError) as error:
                report["failedPatches"][patch] = f"Patch verification failed: {error}"
                continue
            if any((directory / name).read_bytes() != data for name, data in proposed.items()):
                raise ValueError("Candidate changed during verification")
            candidate = proposed
            report["appliedPatches"].append(patch)
    for name, data in candidate.items():
        (target / "server/dist" / name).write_bytes(data)
    if report["appliedPatches"]:
        report["status"] = "partial" if report["failedPatches"] else "patched"
    if report["failedPatches"]:
        report["warning"] = "; ".join(
            f"{patch}: {reason}" for patch, reason in report["failedPatches"].items()
        )
    report["hashes"]["after"] = {
        name: _fingerprint(_optional_bytes(target / "server/dist" / name)) for name in FILES
    }
    report["packageTree"] = _tree_digest(target)
    return report


def prepare_package(package: Path, output: Path, node: Path, set_id: str):
    """Prepare or verify a content-addressed release beneath an absolute store."""
    if not output.is_absolute() or ".." in output.parts:
        raise ValueError("Absolute store path without traversal is required")
    for path in (output, *output.parents):
        if path.is_symlink() and path != Path("/tmp"):
            raise ValueError("Symlinked store path refused")
    source = package.resolve(strict=True)
    store = output.resolve()
    if store.is_relative_to(source) or source.is_relative_to(store):
        raise ValueError("Store and package must not overlap")
    # Validate before creating the store. The probe path need not exist.
    _paths(package, store / ".validation-probe", node)
    if set_id not in SETS:
        raise ValueError(f"Unknown patch set: {set_id}")
    version = subprocess.run(
        [str(node), "--version"], capture_output=True, check=True, timeout=10
    ).stdout
    store.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=store) as temporary:
        staged = Path(temporary) / "release"
        report = _prepare_fresh(package, staged, node, set_id)
        identity = digest(
            json.dumps(
                [
                    set_id,
                    version.decode(),
                    str(source.parent),
                    report["sourceTree"],
                    report["packageTree"],
                    report["provenance"],
                ],
                sort_keys=True,
            ).encode()
        )
        destination = store / identity
        if destination.is_symlink():
            raise ValueError("Symlinked release refused")
        if destination.exists():
            if _tree_digest(destination / "package") != report["packageTree"]:
                raise ValueError("Existing release package tree is corrupt")
            link = destination / "node_modules"
            if not link.is_symlink() or link.resolve() != source.parent:
                raise ValueError("Existing release dependency link differs")
        else:
            staged.rename(destination)
    report["package"] = str(destination / "package")
    report["identity"] = identity
    return report
