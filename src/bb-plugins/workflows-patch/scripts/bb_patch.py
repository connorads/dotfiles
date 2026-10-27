#!/usr/bin/env python3
"""Inspect and prepare pinned BB bundles; transactions admit disposable copies only."""

import argparse
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
import plistlib
import re
import stat
import struct
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "manifests"
DIST = "Contents/Resources/app.asar.unpacked/node_modules/bb-app/server/dist"
FILES = (
    "start-server.js",
    "builtin-plugins/workflows/dist/server.js",
    "builtin-plugins/workflows/dist/app.js",
    "builtin-plugins/workflows/skills/workflows/references/authoring.md",
)
SETS = {
    "session-options": ["session-options"],
    "activity": ["activity"],
    "session-options-plus-activity": ["session-options", "activity"],
}
STATE = Path.home() / ".local/share/bb-bundle-patches/manager"
SYSTEM_TEMP = (
    Path(
        subprocess.run(
            ["/usr/bin/getconf", "DARWIN_USER_TEMP_DIR"], check=True, capture_output=True, text=True
        ).stdout.strip()
    ).resolve()
    if sys.platform == "darwin"
    else Path("/tmp").resolve()
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n"
    ).encode()


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path):
    return json.loads(path.read_bytes(), object_pairs_hook=unique)


def safe_path(path):
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("An absolute path without traversal is required")
    # /tmp is a platform alias on macOS. Resolve it before rejecting deeper links.
    base = SYSTEM_TEMP
    for item in (path, *path.parents):
        if item.is_symlink() and item != Path("/tmp"):
            raise ValueError(f"Symlink path refused: {item}")
    resolved = path.resolve()
    if resolved == base:
        raise ValueError("Temporary root itself is unsafe")
    return resolved


def relative(value):
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or str(path) != value or value == ".":
        raise ValueError(f"Unsafe relative path: {value}")
    return path


def sha(value):
    if not isinstance(value, str) or not re.fullmatch("[0-9a-f]{64}", value):
        raise ValueError("Invalid SHA-256")
    return value


RELEASE_ADAPTERS = {"0.47.1": "scripts/adapters/bb_0_47_1.py"}


def manifests(registry=REGISTRY):
    result = []
    required = {
        "schema",
        "id",
        "status",
        "installation",
        "dist",
        "patches",
        "adapter",
        "files",
        "verification",
        "activation",
        "installerWritesDatabase",
        "runtimeRecordCompatibility",
        "integrityPolicy",
        "retireWhen",
    }
    for path in sorted(registry.glob("*.json")):
        item = read_json(path)
        if set(item) != required or item["schema"] != 1:
            raise ValueError(f"Invalid manifest fields: {path.name}")
        if item["id"] not in SETS or item["patches"] != SETS[item["id"]]:
            raise ValueError("Unknown patch set or order")
        if item["status"] not in {"draft", "approved-offline"} or item["dist"] != DIST:
            raise ValueError("Invalid status or dist")
        identity = item["installation"]
        if (
            identity
            != {
                "kind": "desktop",
                "platform": "darwin",
                "arch": "arm64",
                "version": identity.get("version"),
            }
            or identity["version"] not in RELEASE_ADAPTERS
        ):
            raise ValueError("Unsupported release identity")
        if (
            item["installerWritesDatabase"] is not False
            or item["activation"] != "full-server-activation"
        ):
            raise ValueError("Invalid mutation or activation policy")
        adapter = item["adapter"]
        if (
            set(adapter) != {"path", "sha256"}
            or adapter["path"] != RELEASE_ADAPTERS[identity["version"]]
        ):
            raise ValueError("Undeclared adapter")
        sha(adapter["sha256"])
        paths = [entry["path"] for entry in item["files"]]
        if len(paths) != len(FILES) or set(paths) != set(FILES):
            raise ValueError("Missing or duplicate complete guards")
        for entry in item["files"]:
            if set(entry) != {"path", "pristine", "intermediate", "final"}:
                raise ValueError("Invalid file entry")
            relative(entry["path"])
            for value in [entry["pristine"], entry["final"], *entry["intermediate"]]:
                sha(value)
            if (
                len(entry["intermediate"]) != len(item["patches"])
                or entry["intermediate"][-1] != entry["final"]
            ):
                raise ValueError("Invalid intermediate tuple")
        expected_profiles = ["session-options"] if item["id"] == "session-options" else ["activity"]
        if item["id"] == "session-options-plus-activity":
            expected_profiles = ["session-options", "activity"]
        if (
            set(item["verification"]) != {"profiles", "harnesses"}
            or item["verification"]["profiles"] != expected_profiles
        ):
            raise ValueError("Unknown verification profile")
        expected_harnesses = (
            {"scripts/test-bundle.mjs"} if "session-options" in item["patches"] else set()
        )
        if "activity" in item["patches"]:
            expected_harnesses.add("scripts/test-activity.mjs")
        if set(item["verification"]["harnesses"]) != expected_harnesses:
            raise ValueError("Undeclared verification harness")
        for name, value in item["verification"]["harnesses"].items():
            relative(name)
            sha(value)
        result.append(item)
    keys = [(canonical(m["installation"]), m["id"]) for m in result]
    if not result or len(set(keys)) != len(result):
        raise ValueError("Empty registry or duplicate release set")
    pristine_by_release = {}
    for manifest in result:
        release = canonical(manifest["installation"])
        pristine = {e["path"]: e["pristine"] for e in manifest["files"]}
        if pristine_by_release.setdefault(release, pristine) != pristine:
            raise ValueError("Conflicting pristine tuples")
    return result


def xattrs(path):
    if hasattr(os, "listxattr"):
        return {name: os.getxattr(path, name).hex() for name in os.listxattr(path)}
    names = subprocess.run(
        ["/usr/bin/xattr", str(path)], check=True, capture_output=True, text=True
    ).stdout.splitlines()
    return {
        name: "".join(
            subprocess.run(
                ["/usr/bin/xattr", "-px", name, str(path)],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.split()
        ).lower()
        for name in names
    }


def set_xattrs(path, values):
    for name in xattrs(path):
        if hasattr(os, "removexattr"):
            os.removexattr(path, name)
        else:
            subprocess.run(
                ["/usr/bin/xattr", "-d", name, str(path)], check=True, capture_output=True
            )
    for name, value in values.items():
        if hasattr(os, "setxattr"):
            os.setxattr(path, name, bytes.fromhex(value))
        else:
            subprocess.run(
                ["/usr/bin/xattr", "-wx", name, value, str(path)], check=True, capture_output=True
            )


def metadata(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f"Not a regular file: {path}")
    attributes = xattrs(path)
    has_acl = any("acl" in name.lower() for name in attributes)
    if sys.platform == "darwin":
        listing = subprocess.run(
            ["/bin/ls", "-lde", str(path)], check=True, capture_output=True, text=True
        ).stdout
        has_acl = "+" in listing.split()[0] or bool(re.search(r"^\s*\d+:", listing, re.MULTILINE))
    return {
        "uid": info.st_uid,
        "gid": info.st_gid,
        "mode": stat.S_IMODE(info.st_mode),
        "xattrs": attributes,
        "acl": has_acl,
        **({"flags": info.st_flags} if getattr(info, "st_flags", 0) else {}),
    }


def observe(app):
    app = safe_path(app)
    info_path = safe_path(app / "Contents/Info.plist")
    info = plistlib.loads(info_path.read_bytes())
    exe_name = info["CFBundleExecutable"]
    if Path(exe_name).name != exe_name:
        raise ValueError("Unsafe executable name")
    executable = safe_path(app / "Contents/MacOS" / exe_name)
    header = executable.read_bytes()[:8]
    if len(header) != 8 or header[:4] != b"\xcf\xfa\xed\xfe":
        raise ValueError("Unsupported Mach-O architecture header")
    arch = {0x100000C: "arm64", 0x1000007: "x64"}.get(struct.unpack("<I", header[4:])[0], "unknown")
    root = app.stat()
    targets = {name: safe_path(app / DIST / name) for name in FILES}
    return {
        "app": str(app),
        "identity": {
            "kind": "desktop",
            "platform": "darwin",
            "arch": arch,
            "version": info["CFBundleShortVersionString"],
        },
        "root": [root.st_dev, root.st_ino],
        "generation": {
            "plist": digest(info_path.read_bytes()),
            "executable": digest(executable.read_bytes()),
        },
        "tuple": {name: digest(path.read_bytes()) for name, path in targets.items()},
        "metadata": {name: metadata(path) for name, path in targets.items()},
    }


def journals_for_app(state, app):
    journals = [(path, read_json(path)) for path in (state / "transactions").glob("*.json")]
    return sorted(
        (
            (path, journal)
            for path, journal in journals
            if journal.get("binding", {}).get("app") == str(app)
        ),
        key=lambda pair: (
            pair[1].get("state") not in {"installed-pending-activation", "restored"},
            pair[0].stat().st_mtime_ns,
        ),
    )


def classify(observation, registry, required=None, state=STATE):
    compatible = [m for m in registry if m["installation"] == observation["identity"]]
    observed = observation["tuple"]
    classification, profile, patches = "unknown", None, []
    if compatible:
        pristine = {e["path"]: e["pristine"] for e in compatible[0]["files"]}
        if observed == pristine:
            classification = "stock"
        else:
            for m in compatible:
                if m["status"] != "approved-offline":
                    continue
                if observed == {e["path"]: e["final"] for e in m["files"]}:
                    classification = (
                        "requested-profile"
                        if required in (None, m["id"])
                        else "other-approved-profile"
                    )
                    profile, patches = m["id"], m["patches"]
                    break
            if classification == "unknown":
                legacy = next((m for m in compatible if m["id"] == "session-options"), None)
                if legacy and all(
                    observed[e["path"]] in {e["pristine"], e["final"]} for e in legacy["files"]
                ):
                    classification = "legacy-mixed"
    pending = None
    for path, journal in journals_for_app(state, observation["app"]):
        if journal.get("state") == "restored":
            continue
        pending = {"id": path.stem, "state": journal["state"]}
        if (
            journal["binding"]["root"] == observation["root"]
            and journal["binding"]["generation"] == observation["generation"]
            and all(observed[n] in {journal["before"][n], journal["after"][n]} for n in FILES)
            and observed not in (journal["before"], journal["after"])
        ):
            classification = "journal-backed-mixed"
    missing = sorted(set(SETS[required]) - set(patches)) if required else []
    healthy = classification in {"stock", "requested-profile", "other-approved-profile"}
    return {
        "schema": 1,
        "observation": observation,
        "classification": classification,
        "observedSet": profile,
        "requiredSet": required,
        "missingPatches": missing,
        "pendingTransaction": pending,
        "diskRequirementStatus": "satisfied"
        if healthy and not missing
        else "missing"
        if healthy
        else "blocked",
        "activationStatus": "unknown",
        "runtimeVerificationStatus": "unknown",
    }, (0 if not missing else 1) if healthy else 2


def checked_inputs(manifest):
    inputs = {
        manifest["adapter"]["path"]: manifest["adapter"]["sha256"],
        **manifest["verification"]["harnesses"],
    }
    for name, expected in inputs.items():
        if digest((ROOT / name).read_bytes()) != expected:
            raise ValueError(f"Changed verification input: {name}")
    return inputs


def generate(manifest, pristine):
    checked_inputs(manifest)
    spec = importlib.util.spec_from_file_location(
        "bb_release_adapter", ROOT / manifest["adapter"]["path"]
    )
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    candidate = dict(pristine)
    for entry in manifest["files"]:
        name = entry["path"]
        if digest(candidate[name]) != entry["pristine"]:
            raise ValueError("Missing verified pristine object")
        for index, patch in enumerate(manifest["patches"]):
            candidate[name] = adapter.transform(patch, name, candidate[name])
            if digest(candidate[name]) != entry["intermediate"][index]:
                raise ValueError(f"Intermediate fingerprint mismatch: {patch} {name}")
    return candidate


def get_object(state, key):
    data = (state / "objects" / sha(key)).read_bytes()
    if digest(data) != key:
        raise ValueError("Corrupt object")
    return data


def write_object(state, data):
    key = digest(data)
    path = state / "objects" / key
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        with path.open("xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    get_object(state, key)
    return key


def prepare(app, set_id, output, registry=None, state=STATE):
    registry = manifests() if registry is None else registry
    observation = observe(app)
    _report, code = classify(observation, registry, state=state)
    if code == 2:
        raise ValueError("Unknown or mixed installation cannot prepare executable candidates")
    manifest = next(
        m for m in registry if m["id"] == set_id and m["installation"] == observation["identity"]
    )
    output = safe_path(output)
    app = Path(observation["app"])
    if (
        output.exists()
        or output.is_relative_to(app)
        or app.is_relative_to(output)
        or output.is_relative_to(Path("/Applications/bb.app"))
    ):
        raise ValueError("Output must be fresh and outside installation, without ancestor overlap")
    pristine = {}
    for entry in manifest["files"]:
        name, expected = entry["path"], entry["pristine"]
        pristine[name] = (
            (app / DIST / name).read_bytes()
            if observation["tuple"][name] == expected
            else get_object(state, expected)
        )
    candidate = generate(manifest, pristine)
    payload = {
        "schema": 1,
        "manifest": manifest,
        "inputs": checked_inputs(manifest),
        "pristine": {n: digest(b) for n, b in pristine.items()},
        "candidate": {n: digest(b) for n, b in candidate.items()},
    }
    plan = {"payload": payload, "candidateId": digest(canonical(payload)), "binding": observation}
    if observe(app) != observation:
        raise ValueError("Installation changed during preparation")
    output.mkdir()
    for name in FILES:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(candidate[name])
        target = output / "pristine" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(pristine[name])
    (output / "plan.json").write_bytes(canonical(plan))
    return output / "plan.json"


def verify(plan_path, registry=None):
    plan_path = safe_path(plan_path)
    plan = read_json(plan_path)
    registry_from_disk = registry is None
    registry = manifests() if registry_from_disk else registry
    payload = plan["payload"]
    if plan["candidateId"] != digest(canonical(payload)) or payload["manifest"] not in registry:
        raise ValueError("Plan is not bound to the tracked registry")
    manifest = payload["manifest"]
    if payload["inputs"] != checked_inputs(manifest):
        raise ValueError("Changed verification inputs")
    directory = plan_path.parent
    installation = safe_path(Path(plan["binding"]["app"]))
    if (
        directory.is_relative_to(installation)
        or installation.is_relative_to(directory)
        or directory.is_relative_to(Path("/Applications/bb.app"))
    ):
        raise ValueError("Verification output overlaps an installation")
    evidence_path = safe_path(directory / "verification.json")
    checks = []
    pristine = {n: (safe_path(directory / "pristine" / n)).read_bytes() for n in FILES}
    candidate = generate(manifest, pristine)
    if payload["pristine"] != {n: digest(b) for n, b in pristine.items()} or payload[
        "candidate"
    ] != {n: digest(b) for n, b in candidate.items()}:
        raise ValueError("Changed plan tuples")
    for name in FILES:
        if safe_path(directory / name).read_bytes() != candidate[name]:
            raise ValueError("Candidate tampering")
        if name.endswith(".js"):
            subprocess.run(
                ["node", "--check", str(directory / name)], check=True, capture_output=True
            )
            checks.append({"id": f"syntax:{name}", "exitCode": 0})
    with tempfile.TemporaryDirectory(prefix="bb-patch-verify-") as scratch:
        for profile in manifest["verification"]["profiles"]:
            if profile == "session-options":
                command = [
                    "node",
                    str(ROOT / "scripts/test-bundle.mjs"),
                    str(directory / FILES[1]),
                    str(Path(scratch) / "session.mjs"),
                ]
            else:
                command = [
                    "node",
                    str(ROOT / "scripts/test-activity.mjs"),
                    str(directory / FILES[0]),
                    str(directory / FILES[1]),
                ]
            result = subprocess.run(command, check=True, capture_output=True, text=True)
            checks.append({"id": profile, "exitCode": 0, "stdout": result.stdout})
    if payload["inputs"] != checked_inputs(manifest) or (
        registry_from_disk and manifest not in manifests()
    ):
        raise ValueError("Verification inputs changed during execution")
    for name in FILES:
        if (
            safe_path(directory / name).read_bytes() != candidate[name]
            or safe_path(directory / "pristine" / name).read_bytes() != pristine[name]
        ):
            raise ValueError("Verification bundles changed during execution")
    durable_json(
        evidence_path,
        {
            "schema": 1,
            "candidateId": plan["candidateId"],
            "manifestDigest": digest(canonical(manifest)),
            "inputs": payload["inputs"],
            "checks": checks,
            "activationStatus": "unknown",
            "runtimeVerificationStatus": "unknown",
        },
    )
    return plan


def admit(app):
    app = safe_path(app)
    temporary = SYSTEM_TEMP
    if app == Path("/Applications/bb.app") or not app.is_relative_to(temporary) or app == temporary:
        raise ValueError(
            "Transactions support manager-bound disposable temporary installations only"
        )
    return app


@contextlib.contextmanager
def installation_lock(app, state):
    directory = state / "locks"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / digest(str(app).encode())).open("a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise ValueError("Installation lock is held") from error
        yield


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def durable_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(canonical(value))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    fsync_directory(path.parent)


def supported_metadata(app, observation):
    for name, expected in observation["metadata"].items():
        path = app / DIST / name
        info = path.stat()
        if (
            expected["uid"] != os.getuid()
            or info.st_nlink != 1
            or expected["mode"] & 0o7000
            or not expected["mode"] & stat.S_IWUSR
        ):
            raise ValueError("Unsupported ownership, links or permission bits")
        if expected.get("flags", 0):
            raise ValueError("Unsupported file flags")
        if expected["acl"]:
            raise ValueError("ACL-bearing file refused")
        if metadata(path) != expected:
            raise ValueError("Metadata changed")


def stage_file(target, data, expected):
    with tempfile.NamedTemporaryFile(
        dir=target.parent, prefix=".bb-patch-", delete=False
    ) as handle:
        path = Path(handle.name)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.chmod(path, expected["mode"])
        if path.stat().st_gid != expected["gid"]:
            os.chown(path, -1, expected["gid"])
        set_xattrs(path, expected["xattrs"])
        if metadata(path) != expected or path.read_bytes() != data:
            raise ValueError("Staged bytes or metadata differ")
        with path.open("rb") as handle:
            os.fsync(handle.fileno())
        return path
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def no_checkpoint(_label):
    pass


def revalidate(app, journal, allowed):
    observation = observe(app)
    binding = journal["binding"]
    if any(
        observation[key] != binding[key]
        for key in ("app", "identity", "root", "generation", "metadata")
    ):
        raise ValueError("Installation identity, generation or metadata changed")
    if any(observation["tuple"][n] not in allowed[n] for n in FILES):
        raise ValueError("Unexpected destination bytes preserved")
    return observation


def execute_writes(app, journal, journal_path, desired, state, checkpoint):
    allowed = {n: {journal["before"][n], journal["after"][n]} for n in FILES}
    # Validate all objects and all destinations before staging anything.
    data = {n: get_object(state, desired[n]) for n in FILES}
    revalidate(app, journal, allowed)
    staged = {}
    staged_identity = {}
    try:
        for name in FILES:
            if journal["before"][name] != journal["after"][name]:
                revalidate(app, journal, allowed)
                staged[name] = stage_file(
                    app / DIST / name, data[name], journal["binding"]["metadata"][name]
                )
                info = staged[name].lstat()
                staged_identity[name] = (info.st_dev, info.st_ino)
                checkpoint(f"staged:{name}")
        for name, temporary in staged.items():
            journal["intended"] = name
            durable_json(journal_path, journal)
            checkpoint(f"intent:{name}")
            target = safe_path(app / DIST / name)
            # Staging and destination share this parent. Pin it before final
            # validation so a root swap cannot redirect the rename.
            with contextlib.ExitStack() as stack:
                target_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
                stack.callback(os.close, target_fd)
                current = revalidate(app, journal, allowed)
                if current["tuple"][name] != desired[name]:
                    info = safe_path(temporary).lstat()
                    if (
                        (info.st_dev, info.st_ino) != staged_identity[name]
                        or temporary.read_bytes() != data[name]
                        or metadata(temporary) != journal["binding"]["metadata"][name]
                    ):
                        raise ValueError("Staged candidate changed before replacement")
                    os.replace(
                        temporary.name, target.name, src_dir_fd=target_fd, dst_dir_fd=target_fd
                    )
                    os.fsync(target_fd)
                    checkpoint(f"renamed:{name}")
            if (
                target.read_bytes() != data[name]
                or metadata(target) != journal["binding"]["metadata"][name]
            ):
                raise ValueError("Replacement verification failed")
            allowed[name] = {desired[name]}
            journal["completed"].append(name)
            durable_json(journal_path, journal)
            checkpoint(f"recorded:{name}")
        if revalidate(app, journal, allowed)["tuple"] != desired:
            raise ValueError("Final complete tuple mismatch")
    finally:
        try:
            info = safe_path(app).stat()
            same_root = [info.st_dev, info.st_ino] == journal["binding"]["root"]
        except (OSError, ValueError):
            same_root = False
        if same_root:
            for name, temporary in staged.items():
                if name not in staged_identity or not temporary.exists() or temporary.is_symlink():
                    continue
                try:
                    safe_path(temporary)
                except (OSError, ValueError):
                    continue
                info = temporary.lstat()
                if (info.st_dev, info.st_ino) == staged_identity[
                    name
                ] and temporary.read_bytes() == data[name]:
                    temporary.unlink()


def apply(app, plan_path, state=STATE, registry=None, checkpoint=no_checkpoint):
    app = admit(app)  # Refuse live paths before registry loading, locks or writes.
    with installation_lock(app, state):
        plan = verify(plan_path, registry)
        if plan["payload"]["manifest"]["status"] != "approved-offline":
            raise ValueError("Draft recipes cannot authorise transactions")
        observation = observe(app)
        recipes = manifests() if registry is None else registry
        approved = [m for m in recipes if m["status"] == "approved-offline"]
        report, code = classify(observation, approved, state=state)
        if code == 2:
            raise ValueError("Transaction input is not a complete approved tuple")
        if (
            report["pendingTransaction"]
            and report["pendingTransaction"]["state"] != "installed-pending-activation"
        ):
            raise ValueError("Existing transaction requires explicit restoration")
        for path, previous in journals_for_app(state, app):
            if (
                previous.get("state") == "installed-pending-activation"
                and previous.get("candidateId") == plan["candidateId"]
                and previous.get("binding") == plan["binding"]
                and observation["tuple"] == previous["after"]
            ):
                revalidate(app, previous, {n: {previous["after"][n]} for n in FILES})
                for n in FILES:
                    get_object(state, previous["before"][n])
                    get_object(state, previous["after"][n])
                return path.stem
        if observation != plan["binding"]:
            raise ValueError("Stale plan binding")
        supported_metadata(app, observation)
        transaction_id = uuid.uuid4().hex
        path = state / "transactions" / f"{transaction_id}.json"
        journal = {
            "schema": 1,
            "id": transaction_id,
            "state": "prepared",
            "binding": observation,
            "before": observation["tuple"],
            "after": plan["payload"]["candidate"],
            "candidateId": plan["candidateId"],
            "payload": plan["payload"],
            "completed": [],
            "intended": None,
        }
        # Objects become durable before intent can refer to them.
        for name in FILES:
            for source, expected in (
                (app / DIST / name, journal["before"][name]),
                (Path(plan_path).parent / name, journal["after"][name]),
                (Path(plan_path).parent / "pristine" / name, plan["payload"]["pristine"][name]),
            ):
                if write_object(state, source.read_bytes()) != expected:
                    raise ValueError("Input changed before durable backup")
        fsync_directory(state / "objects")
        durable_json(path, journal)
        checkpoint("prepared")
        revalidate(app, journal, {n: {journal["before"][n]} for n in FILES})
        journal["state"] = "backed-up"
        durable_json(path, journal)
        checkpoint("backed-up")
        journal["state"] = "installing"
        durable_json(path, journal)
        checkpoint("installing")
        try:
            execute_writes(app, journal, path, journal["after"], state, checkpoint)
            journal["state"] = "installed-pending-activation"
            durable_json(path, journal)
            checkpoint("installed-pending-activation")
        except Exception:
            journal["state"] = "restoring"
            durable_json(path, journal)
            try:
                execute_writes(app, journal, path, journal["before"], state, no_checkpoint)
                journal["state"] = "restored"
            except Exception as error:
                journal["state"] = "blocked-unexpected-bytes"
                journal["error"] = str(error)
            durable_json(path, journal)
            raise
        return transaction_id


def restore(app, transaction_id, state=STATE, checkpoint=no_checkpoint, registry=None):
    app = admit(app)
    if not re.fullmatch("[0-9a-f]{32}", transaction_id):
        raise ValueError("Invalid transaction ID")
    with installation_lock(app, state):
        path = state / "transactions" / f"{transaction_id}.json"
        journal = read_json(path)
        if journal["id"] != transaction_id or journal["schema"] != 1:
            raise ValueError("Invalid transaction journal")
        recipes = manifests() if registry is None else registry
        payload = journal["payload"]
        manifest = payload["manifest"]
        if (
            manifest not in recipes
            or manifest["status"] != "approved-offline"
            or journal["candidateId"] != digest(canonical(payload))
        ):
            raise ValueError("Journal does not bind an approved tracked recipe")
        if (
            payload["inputs"] != checked_inputs(manifest)
            or journal["after"] != payload["candidate"]
            or journal["before"] != journal["binding"]["tuple"]
        ):
            raise ValueError("Journal binding differs")
        tuples = [{e["path"]: e["pristine"] for e in manifest["files"]}]
        tuples += [
            {e["path"]: e["final"] for e in m["files"]}
            for m in recipes
            if m["installation"] == journal["binding"]["identity"]
            and m["status"] == "approved-offline"
        ]
        if journal["before"] not in tuples or journal["after"] != {
            e["path"]: e["final"] for e in manifest["files"]
        }:
            raise ValueError("Journal complete tuples are not approved")
        # Verify both sides, including unchanged guards, even for idempotent restore.
        for name in FILES:
            get_object(state, journal["before"][name])
            get_object(state, journal["after"][name])
        observation = revalidate(
            app, journal, {n: {journal["before"][n], journal["after"][n]} for n in FILES}
        )
        supported_metadata(app, observation)
        journal["state"] = "restoring"
        durable_json(path, journal)
        checkpoint("restoring")
        try:
            execute_writes(app, journal, path, journal["before"], state, checkpoint)
            journal["state"] = "restored"
            durable_json(path, journal)
            checkpoint("restored")
        except Exception as error:
            journal["state"] = "blocked-unexpected-bytes"
            journal["error"] = str(error)
            durable_json(path, journal)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    for action in ("inspect", "prepare", "apply", "restore"):
        command = commands.add_parser(action)
        command.add_argument("--app", required=True, type=Path)
        if action == "inspect":
            command.add_argument("--require-set", choices=SETS)
            command.add_argument("--json", action="store_true")
        if action == "prepare":
            command.add_argument("--set", required=True, choices=SETS)
            command.add_argument("--output", required=True, type=Path)
        if action == "apply":
            command.add_argument("--plan", required=True, type=Path)
        if action == "restore":
            command.add_argument("--transaction", required=True)
    command = commands.add_parser("verify")
    command.add_argument("--plan", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.action == "inspect":
            report, code = classify(observe(args.app), manifests(), args.require_set)
            print(
                canonical(report).decode().strip()
                if args.json
                else f"{report['classification']}: missing={report['missingPatches']}; activation=unknown; runtime=unknown"
            )
            return code
        if args.action == "prepare":
            print(prepare(args.app, args.set, args.output))
        elif args.action == "verify":
            print(verify(args.plan)["candidateId"])
        elif args.action == "apply":
            print(apply(args.app, args.plan))
        else:
            restore(args.app, args.transaction)
        return 0
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        StopIteration,
        subprocess.CalledProcessError,
    ) as error:
        diagnostic = {
            "schema": 1,
            "error": str(error),
            "errorKind": "not-installed"
            if args.action == "inspect" and not args.app.exists()
            else "invalid-input",
            "observation": None,
            "classification": "unknown",
            "observedSet": None,
            "requiredSet": getattr(args, "require_set", None),
            "missingPatches": [],
            "pendingTransaction": None,
            "diskRequirementStatus": "blocked",
            "activationStatus": "unknown",
            "runtimeVerificationStatus": "unknown",
        }
        print(json.dumps(diagnostic), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
