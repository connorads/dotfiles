import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "scripts" / "dispatch.py"
SPEC = importlib.util.spec_from_file_location("dispatch", SCRIPT)
assert SPEC
assert SPEC.loader
dispatch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(dispatch)


def manifest(assignments, **overrides):
    value = {
        "run_id": "demo",
        "source_cwd": "/repo",
        "base_sha": "a" * 40,
        "max_concurrency": 6,
        "assignments": assignments,
    }
    value.update(overrides)
    return value


def assignment(identifier, **overrides):
    value = {
        "id": identifier,
        "title": identifier,
        "provider": "codex",
        "mode": "plan",
        "permission": "normal",
        "dependencies": [],
        "prompt": f"Plan {identifier}",
        "window_name": identifier,
        "agent_name": identifier.replace("-", "_"),
        "state": "pending",
    }
    value.update(overrides)
    return value


class FakeRuntime:
    def __init__(self, *, dirty=False, fail_prompt_for=None, plan_visible=True):
        self.dirty = dirty
        self.fail_prompt_for = fail_prompt_for
        self.plan_visible = plan_visible
        self.calls = []

    def require_commands(self, names):
        self.calls.append(("require", tuple(names)))

    def current_session(self, run_id, cwd):
        return "demo-session"

    def existing_window_names(self, session):
        return set()

    def existing_agent_names(self):
        return set()

    def prepare_worktree(self, source_cwd, base_sha, branch):
        self.calls.append(("worktree", source_cwd, base_sha, branch))
        if self.dirty:
            raise dispatch.DispatchError("source checkout is dirty")
        return f"/trees/{branch}"

    def provider_command(self, item):
        return [item["provider"]]

    def launch_pane(self, session, window_name, cwd, command):
        pane = f"%{len([call for call in self.calls if call[0] == 'launch']) + 1}"
        self.calls.append(("launch", pane, session, window_name, cwd, command))
        return pane

    def wait_idle(self, pane):
        self.calls.append(("wait_idle", pane))

    def name_agent(self, pane, name):
        self.calls.append(("name", pane, name))

    def ensure_codex_plan_mode(self, pane):
        self.calls.append(("plan", pane))
        if not self.plan_visible:
            raise dispatch.DispatchError("Codex did not enter Plan mode")

    def prompt(self, pane, text):
        self.calls.append(("prompt", pane, text))
        if self.fail_prompt_for and self.fail_prompt_for in text:
            raise dispatch.DispatchError("prompt did not start")

    def agent_state(self, pane):
        return "working"


class TestManifest:
    def test_rejects_a_concurrency_limit_above_six(self):
        value = manifest([assignment("task")], max_concurrency=7)
        with pytest.raises(dispatch.DispatchError, match="at most 6"):
            dispatch.validate_manifest(value)

    def test_rejects_unsafe_identifiers(self):
        value = manifest([assignment("task")], run_id="unsafe/run")
        with pytest.raises(dispatch.DispatchError, match="lowercase slug"):
            dispatch.validate_manifest(value)

    def test_ready_assignments_are_capped_without_rejecting_later_work(self):
        value = manifest([assignment(f"task-{index}") for index in range(7)])
        dispatch.validate_manifest(value)
        assert len(dispatch.ready_assignments(value)) == 6

    def test_running_assignments_consume_concurrency(self):
        value = manifest(
            [
                assignment("running", state="launched", pane_id="%9"),
                *[assignment(f"task-{index}") for index in range(6)],
            ]
        )
        assert len(dispatch.ready_assignments(value)) == 5

    def test_rejects_unknown_dependency(self):
        value = manifest([assignment("child", dependencies=["missing"])])
        with pytest.raises(dispatch.DispatchError, match="unknown dependency"):
            dispatch.validate_manifest(value)

    def test_ready_assignments_wait_for_launched_dependencies(self):
        value = manifest(
            [
                assignment("first", state="complete"),
                assignment("second", dependencies=["first"]),
                assignment("third", dependencies=["second"]),
            ]
        )
        assert [item["id"] for item in dispatch.ready_assignments(value)] == ["second"]


class TestLaunch:
    def write_manifest(self, tmp_path, value):
        path = tmp_path / "manifest.json"
        path.write_text(json.dumps(value))
        return path

    def test_codex_plan_mode_is_confirmed_before_prompt(self, tmp_path):
        path = self.write_manifest(tmp_path, manifest([assignment("alpha")]))
        runtime = FakeRuntime()
        dispatch.launch_manifest(path, runtime)
        steps = [call[0] for call in runtime.calls]
        assert steps.index("plan") < steps.index("prompt")
        assert steps.index("prompt") < steps.index("name")
        assert json.loads(path.read_text())["assignments"][0]["state"] == "launched"

    def test_plan_confirmation_failure_is_recorded(self, tmp_path):
        path = self.write_manifest(tmp_path, manifest([assignment("alpha")]))
        with pytest.raises(dispatch.DispatchError, match="Plan mode"):
            dispatch.launch_manifest(path, FakeRuntime(plan_visible=False))
        stored = json.loads(path.read_text())["assignments"][0]
        assert stored["state"] == "failed"
        assert stored["error"] != ""

    def test_dirty_checkout_blocks_implementation_before_launch(self, tmp_path):
        item = assignment("alpha", mode="implement")
        path = self.write_manifest(tmp_path, manifest([item]))
        runtime = FakeRuntime(dirty=True)
        with pytest.raises(dispatch.DispatchError, match="dirty"):
            dispatch.launch_manifest(path, runtime)
        assert "launch" not in [call[0] for call in runtime.calls]

    def test_partial_failure_preserves_prior_launch_and_stops_wave(self, tmp_path):
        path = self.write_manifest(
            tmp_path,
            manifest(
                [
                    assignment("first"),
                    assignment("second"),
                    assignment("third"),
                ]
            ),
        )
        runtime = FakeRuntime(fail_prompt_for="second")
        with pytest.raises(dispatch.DispatchError, match="prompt did not start"):
            dispatch.launch_manifest(path, runtime)
        states = [item["state"] for item in json.loads(path.read_text())["assignments"]]
        assert states == ["launched", "failed", "pending"]

    def test_retry_reuses_the_recorded_pane(self, tmp_path):
        failed = assignment(
            "alpha",
            state="failed",
            pane_id="%7",
            cwd="/repo",
            agent_named=True,
            error="prompt did not start",
        )
        path = self.write_manifest(tmp_path, manifest([failed]))
        runtime = FakeRuntime()
        result = dispatch.retry_assignment(path, "alpha", runtime)
        assert result["launched"][0]["pane"] == "%7"
        assert "launch" not in [call[0] for call in runtime.calls]
        assert json.loads(path.read_text())["assignments"][0]["state"] == "launched"

    def test_retry_without_a_pane_rejects_a_window_collision(self, tmp_path):
        failed = assignment("alpha", state="failed", error="launch failed")
        path = self.write_manifest(tmp_path, manifest([failed]))
        runtime = FakeRuntime()
        runtime.existing_window_names = lambda _session: {"alpha"}
        with pytest.raises(dispatch.DispatchError, match="window already exists"):
            dispatch.retry_assignment(path, "alpha", runtime)


class TestLaunchCommand:
    def default_prefix(self, yolo):
        return ["claude", "--append", *(["--yolo-flags"] if yolo else [])]

    def test_default_claude_uses_the_launch_flags_helper(self):
        item = assignment("alpha", provider="claude", mode="implement")
        assert dispatch.provider_command(item, self.default_prefix) == ["claude", "--append"]

    def test_custom_command_replaces_the_claude_prefix(self):
        item = assignment("alpha", provider="claude", mode="plan", command=["ccp", "str"])
        assert dispatch.provider_command(item, self.default_prefix) == [
            "ccp",
            "str",
            "--permission-mode",
            "plan",
        ]

    def test_auto_permission_sets_claude_auto_mode(self):
        item = assignment(
            "alpha", provider="claude", mode="implement", permission="auto", command=["ccp", "str"]
        )
        assert dispatch.provider_command(item, self.default_prefix) == [
            "ccp",
            "str",
            "--permission-mode",
            "auto",
        ]

    def test_bypass_with_custom_command_skips_permissions(self):
        item = assignment(
            "alpha",
            provider="claude",
            mode="implement",
            permission="bypass",
            command=["ccp", "str"],
        )
        assert dispatch.provider_command(item, self.default_prefix) == [
            "ccp",
            "str",
            "--dangerously-skip-permissions",
        ]

    def test_rejects_auto_permission_for_codex(self):
        value = manifest([assignment("alpha", permission="auto")])
        with pytest.raises(dispatch.DispatchError, match="auto"):
            dispatch.validate_manifest(value)

    def test_rejects_auto_permission_in_plan_mode(self):
        value = manifest([assignment("alpha", provider="claude", permission="auto")])
        with pytest.raises(dispatch.DispatchError, match="auto"):
            dispatch.validate_manifest(value)

    def test_rejects_an_empty_command(self):
        value = manifest([assignment("alpha", command=[])])
        with pytest.raises(dispatch.DispatchError, match="command"):
            dispatch.validate_manifest(value)

    def test_custom_command_is_the_required_executable(self):
        item = assignment("alpha", provider="claude", command=["ccp", "str"])
        names = dispatch._required_commands([item])
        assert "ccp" in names
        assert "claude-launch-flags" not in names


class RecordingRuntime(dispatch.Runtime):
    def __init__(self, screen=""):
        self.screen = screen
        self.argvs = []

    def run(self, argv, *, cwd=None, check=True):
        self.argvs.append(argv)
        stdout = self.screen if argv[:2] == ["tmux", "capture-pane"] else ""
        return dispatch.subprocess.CompletedProcess(argv, 0, stdout, "")


class TestRuntime:
    def test_commands_run_with_stdin_closed(self, monkeypatch):
        seen = {}

        def fake_run(argv, **kwargs):
            seen.update(kwargs)
            return dispatch.subprocess.CompletedProcess(argv, 0, "", "")

        monkeypatch.setattr(dispatch.subprocess, "run", fake_run)
        dispatch.Runtime().run(["true"])
        assert seen["stdin"] is dispatch.subprocess.DEVNULL

    def test_folder_trust_dialog_is_not_treated_as_idle(self):
        runtime = RecordingRuntime(" Yes, I trust this folder\n")
        with pytest.raises(dispatch.DispatchError, match="trust"):
            runtime.wait_idle("%3")

    def test_idle_composer_passes(self):
        RecordingRuntime("> \n").wait_idle("%3")
