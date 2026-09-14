"""Validate and launch an approved coding-agent dispatch manifest."""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Protocol

MAX_CONCURRENCY = 6
AGENT_NAME = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")
WINDOW_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$")
VALID_PROVIDERS = {"claude", "codex"}
VALID_MODES = {"plan", "implement"}
VALID_PERMISSIONS = {"normal", "bypass"}
VALID_STATES = {"pending", "launched", "complete", "failed"}


class DispatchError(RuntimeError):
    """An actionable dispatch failure."""


class DispatchRuntime(Protocol):
    def require_commands(self, names: list[str]) -> None: ...

    def current_session(self, run_id: str, cwd: str) -> str: ...

    def existing_window_names(self, session: str) -> set[str]: ...

    def existing_agent_names(self) -> set[str]: ...

    def prepare_worktree(self, source_cwd: str, base_sha: str, branch: str) -> str: ...

    def provider_command(self, item: dict[str, Any]) -> list[str]: ...

    def launch_pane(self, session: str, window_name: str, cwd: str, command: list[str]) -> str: ...

    def wait_idle(self, pane: str) -> None: ...

    def name_agent(self, pane: str, name: str) -> None: ...

    def ensure_codex_plan_mode(self, pane: str) -> None: ...

    def prompt(self, pane: str, text: str) -> None: ...

    def agent_state(self, pane: str) -> str: ...


def _required_string(value: dict[str, Any], key: str, context: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result.strip():
        raise DispatchError(f"{context}.{key} must be a non-empty string")
    return result


def validate_manifest(manifest: dict[str, Any]) -> None:
    if not isinstance(manifest, dict):
        raise DispatchError("manifest must be a JSON object")
    run_id = _required_string(manifest, "run_id", "manifest")
    if not SLUG.fullmatch(run_id):
        raise DispatchError("manifest.run_id must be a lowercase slug")
    source_cwd = _required_string(manifest, "source_cwd", "manifest")
    if not Path(source_cwd).is_absolute():
        raise DispatchError("manifest.source_cwd must be an absolute path")
    base_sha = _required_string(manifest, "base_sha", "manifest")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", base_sha):
        raise DispatchError("manifest.base_sha must be a full 40-character Git SHA")
    limit = manifest.get("max_concurrency", MAX_CONCURRENCY)
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1:
        raise DispatchError("manifest.max_concurrency must be a positive integer")
    if limit > MAX_CONCURRENCY:
        raise DispatchError(f"manifest.max_concurrency must be at most {MAX_CONCURRENCY}")
    assignments = manifest.get("assignments")
    if not isinstance(assignments, list) or not assignments:
        raise DispatchError("manifest.assignments must be a non-empty array")

    ids: set[str] = set()
    windows: set[str] = set()
    agents: set[str] = set()
    for index, item in enumerate(assignments):
        context = f"manifest.assignments[{index}]"
        if not isinstance(item, dict):
            raise DispatchError(f"{context} must be an object")
        identifier = _required_string(item, "id", context)
        if not SLUG.fullmatch(identifier):
            raise DispatchError(f"{context}.id must be a lowercase slug")
        if identifier in ids:
            raise DispatchError(f"duplicate assignment id: {identifier}")
        ids.add(identifier)
        _required_string(item, "title", context)
        _required_string(item, "prompt", context)
        provider = _required_string(item, "provider", context)
        mode = _required_string(item, "mode", context)
        permission = _required_string(item, "permission", context)
        state = _required_string(item, "state", context)
        if provider not in VALID_PROVIDERS:
            raise DispatchError(f"{context}.provider must be claude or codex")
        if mode not in VALID_MODES:
            raise DispatchError(f"{context}.mode must be plan or implement")
        if permission not in VALID_PERMISSIONS:
            raise DispatchError(f"{context}.permission must be normal or bypass")
        if state not in VALID_STATES:
            raise DispatchError(f"{context}.state must be pending, launched, complete, or failed")
        window = _required_string(item, "window_name", context)
        agent = _required_string(item, "agent_name", context)
        if window in windows:
            raise DispatchError(f"duplicate window name: {window}")
        if agent in agents:
            raise DispatchError(f"duplicate agent name: {agent}")
        if not AGENT_NAME.fullmatch(agent):
            raise DispatchError(f"invalid agent name: {agent}")
        if not WINDOW_NAME.fullmatch(window):
            raise DispatchError(f"invalid window name: {window}")
        windows.add(window)
        agents.add(agent)
        dependencies = item.get("dependencies")
        if not isinstance(dependencies, list) or not all(
            isinstance(dependency, str) and dependency for dependency in dependencies
        ):
            raise DispatchError(f"{context}.dependencies must be an array of ids")

    for item in assignments:
        for dependency in item["dependencies"]:
            if dependency not in ids:
                raise DispatchError(f"assignment {item['id']} has unknown dependency: {dependency}")
            if dependency == item["id"]:
                raise DispatchError(f"assignment {item['id']} depends on itself")

    visiting: set[str] = set()
    visited: set[str] = set()
    by_id = {item["id"]: item for item in assignments}

    def visit(identifier: str) -> None:
        if identifier in visiting:
            raise DispatchError(f"dependency cycle includes {identifier}")
        if identifier in visited:
            return
        visiting.add(identifier)
        for dependency in by_id[identifier]["dependencies"]:
            visit(dependency)
        visiting.remove(identifier)
        visited.add(identifier)

    for identifier in ids:
        visit(identifier)


def assignment_wave(manifest: dict[str, Any], identifier: str) -> int:
    by_id = {item["id"]: item for item in manifest["assignments"]}
    cache: dict[str, int] = {}

    def calculate(current: str) -> int:
        if current not in cache:
            dependencies = by_id[current]["dependencies"]
            cache[current] = (
                1 if not dependencies else max(calculate(value) for value in dependencies) + 1
            )
        return cache[current]

    return calculate(identifier)


def ready_assignments(manifest: dict[str, Any], wave: int | None = None) -> list[dict[str, Any]]:
    by_id = {item["id"]: item for item in manifest["assignments"]}
    active = sum(item["state"] == "launched" for item in manifest["assignments"])
    available = max(0, manifest.get("max_concurrency", MAX_CONCURRENCY) - active)
    ready = [
        item
        for item in manifest["assignments"]
        if item["state"] == "pending"
        and all(by_id[dependency]["state"] == "complete" for dependency in item["dependencies"])
        and (wave is None or assignment_wave(manifest, item["id"]) == wave)
    ]
    return ready[:available]


def write_manifest(path: Path, manifest: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, delete=False
    ) as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


class Runtime:
    def run(
        self,
        argv: list[str],
        *,
        cwd: str | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        try:
            return subprocess.run(
                argv,
                cwd=cwd,
                check=check,
                text=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as error:
            detail = error.stderr.strip() or error.stdout.strip() or f"exit {error.returncode}"
            raise DispatchError(f"{shlex.join(argv)} failed: {detail}") from error
        except FileNotFoundError as error:
            raise DispatchError(f"required command not found: {argv[0]}") from error

    def require_commands(self, names: list[str]) -> None:
        missing = [name for name in names if shutil.which(name) is None]
        if missing:
            raise DispatchError(f"required command not found: {', '.join(sorted(set(missing)))}")

    def current_session(self, run_id: str, cwd: str) -> str:
        if os.environ.get("TMUX"):
            return self.run(["tmux", "display-message", "-p", "#{session_name}"]).stdout.strip()
        session = f"dispatch-{run_id}"
        exists = self.run(["tmux", "has-session", "-t", session], check=False)
        if exists.returncode != 0:
            self.run(
                [
                    "tmux",
                    "new-session",
                    "-d",
                    "-s",
                    session,
                    "-n",
                    "dispatch-control",
                    "-c",
                    cwd,
                ]
            )
        return session

    def existing_window_names(self, session: str) -> set[str]:
        result = self.run(["tmux", "list-windows", "-t", session, "-F", "#{window_name}"])
        return {line for line in result.stdout.splitlines() if line}

    def existing_agent_names(self) -> set[str]:
        result = self.run(["agent", "ls", "--json"])
        try:
            items = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise DispatchError("agent ls --json returned invalid JSON") from error
        return {item["name"] for item in items if item.get("name")}

    def prepare_worktree(self, source_cwd: str, base_sha: str, branch: str) -> str:
        status = self.run(["git", "-C", source_cwd, "status", "--porcelain"]).stdout
        if status:
            raise DispatchError(
                "source checkout is dirty; commit the required state before implementation fan-out"
            )
        head = self.run(["git", "-C", source_cwd, "rev-parse", "HEAD"]).stdout.strip()
        if head != base_sha:
            raise DispatchError(
                f"source HEAD changed after approval: expected {base_sha}, found {head}"
            )
        helper = shutil.which("wt-add")
        if helper:
            argv = [helper]
        else:
            config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
            helper_path = config_home / "zsh" / "functions" / "git" / "wt-add"
            if not helper_path.is_file():
                raise DispatchError("wt-add is required for implementation dispatch")
            argv = ["zsh", "--no-rcs", str(helper_path)]
        result = self.run(
            [*argv, "--no-fetch", "--base", base_sha, "--json", branch], cwd=source_cwd
        )
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise DispatchError("wt-add returned invalid JSON") from error
        path = payload.get("path")
        if not isinstance(path, str) or not path:
            raise DispatchError("wt-add did not return a worktree path")
        return path

    def provider_command(self, item: dict[str, Any]) -> list[str]:
        if item["provider"] == "codex":
            command = ["codex"]
            if item["permission"] == "bypass":
                command.append("--dangerously-bypass-approvals-and-sandbox")
            return command
        flags_command = ["claude-launch-flags"]
        if item["permission"] == "bypass":
            flags_command.append("--yolo")
        flags = shlex.split(self.run(flags_command).stdout)
        command = ["claude", *flags]
        if item["mode"] == "plan":
            command.extend(["--permission-mode", "plan"])
        return command

    def launch_pane(self, session: str, window_name: str, cwd: str, command: list[str]) -> str:
        result = self.run(
            [
                "tmux",
                "new-window",
                "-d",
                "-P",
                "-F",
                "#{pane_id}",
                "-t",
                session,
                "-n",
                window_name,
                "-c",
                cwd,
                shlex.join(command),
            ]
        )
        pane = result.stdout.strip()
        if not pane.startswith("%"):
            raise DispatchError("tmux did not return a pane id")
        return pane

    def wait_idle(self, pane: str) -> None:
        self.run(["agent", "wait", pane, "--for", "idle,done", "--timeout", "60"])

    def name_agent(self, pane: str, name: str) -> None:
        self.run(["agent", "name", pane, name])

    def ensure_codex_plan_mode(self, pane: str) -> None:
        capture = self.run(["tmux", "capture-pane", "-p", "-t", pane]).stdout
        if "Plan mode" not in capture:
            self.run(["tmux", "send-keys", "-t", pane, "BTab"])
            capture = self.run(["tmux", "capture-pane", "-p", "-t", pane]).stdout
        if "Plan mode" not in capture:
            raise DispatchError("Codex did not enter Plan mode")

    def prompt(self, pane: str, text: str) -> None:
        self.run(["agent", "prompt", pane, "--", text])

    def agent_state(self, pane: str) -> str:
        return self.run(["agent", "state", pane]).stdout.strip()


def _required_commands(assignments: list[dict[str, Any]]) -> list[str]:
    names = ["agent", "tmux"]
    providers = {item["provider"] for item in assignments}
    if "codex" in providers:
        names.append("codex")
    if "claude" in providers:
        names.extend(["claude", "claude-launch-flags"])
    if any(item["mode"] == "implement" for item in assignments):
        names.extend(["git", "zsh"])
    return names


def refresh_completed(manifest: dict[str, Any], runtime: DispatchRuntime) -> None:
    for item in manifest["assignments"]:
        if item["state"] != "launched" or not item.get("pane_id"):
            continue
        if runtime.agent_state(item["pane_id"]) in {"done", "idle"}:
            item["state"] = "complete"


def _launch_item(
    manifest: dict[str, Any],
    item: dict[str, Any],
    session: str,
    runtime: DispatchRuntime,
) -> dict[str, str]:
    cwd = item.get("cwd") or manifest["source_cwd"]
    if item["mode"] == "implement" and not item.get("worktree"):
        branch = item.get("branch") or f"dispatch/{manifest['run_id']}/{item['id']}"
        cwd = runtime.prepare_worktree(manifest["source_cwd"], manifest["base_sha"], branch)
        item["branch"] = branch
        item["worktree"] = cwd
    command = runtime.provider_command(item)
    pane = item.get("pane_id") or runtime.launch_pane(session, item["window_name"], cwd, command)
    item["pane_id"] = pane
    item["cwd"] = cwd
    runtime.wait_idle(pane)
    if item["provider"] == "codex" and item["mode"] == "plan":
        runtime.ensure_codex_plan_mode(pane)
    runtime.prompt(pane, item["prompt"])
    if not item.get("agent_named"):
        runtime.name_agent(pane, item["agent_name"])
        item["agent_named"] = True
    item["state"] = "launched"
    item.pop("error", None)
    return {
        "id": item["id"],
        "agent": item["agent_name"],
        "provider": item["provider"],
        "mode": item["mode"],
        "window": item["window_name"],
        "pane": pane,
        "cwd": cwd,
        "state": item["state"],
    }


def launch_manifest(
    path: Path, runtime: DispatchRuntime | None = None, wave: int | None = None
) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DispatchError(f"cannot read manifest {path}: {error}") from error
    validate_manifest(manifest)
    runtime = runtime or Runtime()
    runtime.require_commands(["agent", "tmux"])
    refresh_completed(manifest, runtime)
    write_manifest(path, manifest)
    ready = ready_assignments(manifest, wave)
    if not ready:
        raise DispatchError("no capacity for pending assignments with satisfied dependencies")
    runtime.require_commands(_required_commands(ready))
    session = runtime.current_session(manifest["run_id"], manifest["source_cwd"])
    windows = runtime.existing_window_names(session)
    agents = runtime.existing_agent_names()
    for item in ready:
        if item["window_name"] in windows:
            raise DispatchError(f"tmux window already exists: {item['window_name']}")
        if item["agent_name"] in agents:
            raise DispatchError(f"agent name already exists: {item['agent_name']}")

    launched: list[dict[str, str]] = []
    for item in ready:
        try:
            launched.append(_launch_item(manifest, item, session, runtime))
            write_manifest(path, manifest)
        except DispatchError as error:
            item["state"] = "failed"
            item["error"] = str(error)
            write_manifest(path, manifest)
            raise
    return {"run_id": manifest["run_id"], "session": session, "launched": launched}


def retry_assignment(
    path: Path, identifier: str, runtime: DispatchRuntime | None = None
) -> dict[str, Any]:
    manifest = load_manifest(path)
    item = next((value for value in manifest["assignments"] if value["id"] == identifier), None)
    if item is None:
        raise DispatchError(f"unknown assignment: {identifier}")
    if item["state"] != "failed":
        raise DispatchError(f"assignment {identifier} is not failed")
    runtime = runtime or Runtime()
    runtime.require_commands(_required_commands([item]))
    session = runtime.current_session(manifest["run_id"], manifest["source_cwd"])
    if not item.get("pane_id"):
        if item["window_name"] in runtime.existing_window_names(session):
            raise DispatchError(f"tmux window already exists: {item['window_name']}")
        if item["agent_name"] in runtime.existing_agent_names():
            raise DispatchError(f"agent name already exists: {item['agent_name']}")
    try:
        launched = _launch_item(manifest, item, session, runtime)
        write_manifest(path, manifest)
        return {
            "run_id": manifest["run_id"],
            "session": session,
            "launched": [launched],
        }
    except DispatchError as error:
        item["state"] = "failed"
        item["error"] = str(error)
        write_manifest(path, manifest)
        raise


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DispatchError(f"cannot read manifest {path}: {error}") from error
    validate_manifest(manifest)
    return manifest


def positive_integer(value: str) -> int:
    result = int(value)
    if result < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("check", "launch"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--manifest", required=True, type=Path)
        if command == "launch":
            subparser.add_argument("--wave", type=positive_integer)
    retry = subparsers.add_parser("retry")
    retry.add_argument("--manifest", required=True, type=Path)
    retry.add_argument("--assignment", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            manifest = load_manifest(args.manifest)
            result = {
                "run_id": manifest["run_id"],
                "ready": [item["id"] for item in ready_assignments(manifest)],
            }
        elif args.command == "launch":
            result = launch_manifest(args.manifest, wave=args.wave)
        else:
            result = retry_assignment(args.manifest, args.assignment)
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except DispatchError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
