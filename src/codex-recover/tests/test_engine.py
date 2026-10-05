from dataclasses import replace

import pytest
from codex_recover.engine import (
    Backoff,
    GoalChanged,
    Mutation,
    Recheck,
    Rechecked,
    Recovering,
    Stop,
    Stopped,
    Tick,
    TurnChanged,
    UserSubmitted,
    Watching,
    arm,
    step,
)
from codex_recover.model import Goal, GoalIntent, Snapshot, Turn, UserMessage


def goal(status="active", budget=1000, tokens=10):
    return Goal(GoalIntent("objective-digest", budget, 1), status, tokens)


def snapshot(status="inProgress", current_goal=None, error=None):
    return Snapshot(
        "active" if status == "inProgress" else "idle",
        False,
        Turn("t1", status, error, (UserMessage("u1", None),)),
        current_goal,
    )


def ready(state, now=0, snap=None, client_id="own-1"):
    state, effects = step(state, Tick(), now)
    assert effects == (Recheck("t1"),)
    return step(
        state, Rechecked(snap or snapshot("failed", error="cyberPolicy"), True, client_id), now
    )


@pytest.mark.parametrize("error", ["cyberPolicy", "serverOverloaded", "httpConnectionFailed"])
def test_terminal_failure_gets_one_ordinary_continuation(error):
    state = arm(snapshot(), 0)
    state, effects = step(state, TurnChanged(Turn("t1", "failed", error)), 1)
    assert isinstance(state, Backoff)
    assert not effects
    state, effects = ready(state, 1, snapshot("failed", error=error))
    assert isinstance(state, Recovering)
    assert effects == (Mutation("t1", "own-1", False),)
    state, effects = step(state, TurnChanged(Turn("t1", "failed", error)), 2)
    assert not effects
    assert state.data.attempted == frozenset({"t1"})


def test_goal_recovery_preserves_intent_and_tracks_early_blocked_update():
    state = arm(snapshot(current_goal=goal()), 0)
    state, _ = step(state, GoalChanged(goal("blocked"), "t1"), 1)
    assert isinstance(state, Watching)
    state, _ = step(state, TurnChanged(Turn("t1", "failed", "serverOverloaded")), 2)
    state, effects = ready(state, 2, snapshot("failed", goal("blocked"), "serverOverloaded"))
    assert effects == (Mutation("t1", None, True),)
    assert state.data.intent == goal().intent


@pytest.mark.parametrize(
    ("event", "reason"),
    [
        (UserSubmitted(UserMessage("manual", "other")), "manual-prompt"),
        (Stop("interactive-request"), "interactive-request"),
        (TurnChanged(Turn("t1", "interrupted")), "interrupted"),
        (GoalChanged(goal("paused"), None), "goal-paused"),
        (GoalChanged(None, None), "goal-changed"),
        (GoalChanged(goal(budget=999), None), "goal-changed"),
        (GoalChanged(goal(tokens=1000), "t1"), "goal-limit"),
    ],
)
def test_human_actions_and_limits_stop_backoff(event, reason):
    state = arm(snapshot("failed", goal("blocked"), "cyberPolicy"), 0)
    state, effects = step(state, event, 1)
    assert isinstance(state, Stopped)
    assert state.reason == reason
    assert not effects
    assert not step(state, Tick(), 100)[1]


def test_own_prompt_before_response_is_recognised():
    state, _ = ready(arm(snapshot("failed", error="cyberPolicy"), 0))
    state, _ = step(state, UserSubmitted(UserMessage("u-own", "own-1")), 1)
    assert not isinstance(state, Stopped)
    state, _ = step(state, TurnChanged(Turn("t2", "inProgress")), 1)
    state, _ = step(state, TurnChanged(Turn("t2", "completed")), 2)
    assert isinstance(state, Stopped)
    assert state.reason == "task-complete"


def test_goal_success_and_native_continuation_remain_armed():
    state = arm(snapshot(current_goal=goal()), 0)
    state, _ = step(state, TurnChanged(Turn("t1", "completed")), 1)
    assert isinstance(state, Watching)
    state, _ = step(state, TurnChanged(Turn("native", "inProgress")), 2)
    assert isinstance(state, Watching)
    state, _ = step(state, GoalChanged(goal("blocked"), "native"), 3)
    state, _ = step(state, TurnChanged(Turn("native", "completed")), 4)
    assert isinstance(state, Stopped)
    assert state.reason == "goal-blocked"


def test_backoff_caps_and_goal_success_resets_it():
    state = arm(snapshot("failed", goal("blocked"), "cyberPolicy"), 0)
    now = 0
    for index, delay in enumerate((0, 15, 30, 60, 120, 240, 300, 300)):
        turn_id = f"t{index + 1}"
        assert isinstance(state, Backoff)
        assert state.until == now + delay
        now = state.until
        state, effects = step(state, Tick(), now)
        assert effects == (Recheck(turn_id),)
        snap = replace(
            snapshot("failed", goal("blocked"), "cyberPolicy"),
            turn=Turn(turn_id, "failed", "cyberPolicy"),
        )
        state, effects = step(state, Rechecked(snap, True, "unused"), now)
        assert effects == (Mutation(turn_id, None, True),)
        next_turn = f"t{index + 2}"
        state, _ = step(state, TurnChanged(Turn(next_turn, "inProgress")), now)
        state, _ = step(state, TurnChanged(Turn(next_turn, "failed", "cyberPolicy")), now)
    state, _ = step(state, TurnChanged(Turn("success", "inProgress")), now)
    state, _ = step(state, GoalChanged(goal(), None), now)
    state, _ = step(state, TurnChanged(Turn("success", "completed")), now)
    assert state.data.retries == 0


@pytest.mark.parametrize(
    "changed",
    [
        snapshot("failed", error="unknown"),
        replace(snapshot("failed", error="cyberPolicy"), thread_status="active"),
        replace(snapshot("failed", error="cyberPolicy"), turn=Turn("new", "failed", "cyberPolicy")),
        replace(snapshot("failed", error="cyberPolicy"), interactive=True),
    ],
)
def test_final_recheck_prevents_mutation(changed):
    state = arm(snapshot("failed", error="cyberPolicy"), 0)
    state, _ = step(state, Tick(), 0)
    state, effects = step(state, Rechecked(changed, True, "own"), 0)
    assert isinstance(state, Stopped)
    assert not effects


def test_deadline_and_persistent_consumption():
    snap = snapshot("failed", error="cyberPolicy")
    assert isinstance(arm(snap, 0, attempted=frozenset({"t1"})), Stopped)
    state, effects = step(arm(snap, 0), Tick(), 8 * 3600)
    assert isinstance(state, Stopped)
    assert state.reason == "expired"
    assert not effects


@pytest.mark.parametrize(
    "snap",
    [
        snapshot("completed"),
        snapshot("interrupted"),
        snapshot("failed", error="unauthorized"),
        snapshot(current_goal=goal("paused")),
    ],
)
def test_ineligible_attachment(snap):
    assert isinstance(arm(snap, 0), Stopped)
