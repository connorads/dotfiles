"""Pure transitions. The caller supplies time, snapshots and mutation IDs."""

from dataclasses import dataclass, replace

from codex_recover.model import RECOVERABLE, Goal, GoalIntent, Snapshot, Turn, UserMessage

LIFETIME = 8 * 3600
BACKOFF = (0, 15, 30, 60, 120, 240, 300)


@dataclass(frozen=True)
class Session:
    expires: float
    intent: GoalIntent | None
    goal: Goal | None
    turn: Turn | None
    attempted: frozenset[str]
    own_clients: frozenset[str]
    known_users: frozenset[str]
    finished: frozenset[str] = frozenset()
    retries: int = 0
    blocked_turn: str | None = None


@dataclass(frozen=True)
class Watching:
    data: Session


@dataclass(frozen=True)
class Backoff:
    data: Session
    failed_turn: str
    until: float


@dataclass(frozen=True)
class Recovering:
    data: Session
    failed_turn: str
    sent: bool = False


@dataclass(frozen=True)
class Stopped:
    data: Session
    reason: str


type State = Watching | Backoff | Recovering | Stopped


@dataclass(frozen=True)
class Tick:
    pass


@dataclass(frozen=True)
class Stop:
    reason: str


@dataclass(frozen=True)
class TurnChanged:
    turn: Turn


@dataclass(frozen=True)
class GoalChanged:
    goal: Goal | None
    turn_id: str | None


@dataclass(frozen=True)
class UserSubmitted:
    user: UserMessage


@dataclass(frozen=True)
class Rechecked:
    snapshot: Snapshot
    pane_valid: bool
    client_id: str
    failed_turn: str


type Event = Tick | Stop | TurnChanged | GoalChanged | UserSubmitted | Rechecked


@dataclass(frozen=True)
class Recheck:
    failed_turn: str


@dataclass(frozen=True)
class Mutation:
    failed_turn: str
    client_id: str | None
    goal: bool


type Effect = Recheck | Mutation
type Transition = tuple[State, tuple[Effect, ...]]


def goal_stop(data: Session, goal: Goal | None) -> str | None:
    if (goal.intent if goal else None) != data.intent:
        return "goal-changed"
    if goal is None:
        return None
    if goal.status in ("budgetLimited", "usageLimited") or (
        goal.intent.token_budget is not None and goal.tokens_used >= goal.intent.token_budget
    ):
        return "goal-limit"
    if goal.status == "paused":
        return "goal-paused"
    if goal.status == "complete":
        return "goal-complete"
    return None


def failure_state(data: Session, now: float) -> State:
    turn = data.turn
    if turn is None:
        return Stopped(data, "no-task")
    if turn.status == "interrupted":
        return Stopped(data, "interrupted")
    if turn.status == "inProgress":
        return Watching(data)
    if turn.status == "completed":
        if data.intent is None:
            return Stopped(data, "task-complete")
        if data.goal and data.goal.status == "blocked" and data.blocked_turn == turn.turn_id:
            return Stopped(data, "goal-blocked")
        return Watching(replace(data, retries=0))
    if turn.error not in RECOVERABLE:
        return Stopped(data, "ineligible-error")
    if turn.turn_id in data.attempted:
        return Stopped(data, "already-attempted")
    delay = BACKOFF[min(data.retries, len(BACKOFF) - 1)]
    return Backoff(data, turn.turn_id, now + delay)


def arm(
    snapshot: Snapshot,
    now: float,
    *,
    attempted: frozenset[str] = frozenset(),
    own_clients: frozenset[str] = frozenset(),
) -> State:
    data = Session(
        expires=now + LIFETIME,
        intent=snapshot.goal.intent if snapshot.goal else None,
        goal=snapshot.goal,
        turn=snapshot.turn,
        attempted=attempted,
        own_clients=own_clients,
        known_users=frozenset(u.item_id for u in snapshot.turn.users)
        if snapshot.turn
        else frozenset(),
    )
    if snapshot.interactive:
        return Stopped(data, "interactive-request")
    if snapshot.queued:
        return Stopped(data, "manual-prompt")
    if snapshot.thread_status in ("notLoaded", "systemError"):
        return Stopped(data, "thread-unavailable")
    reason = goal_stop(data, snapshot.goal)
    if reason:
        return Stopped(data, reason)
    state = failure_state(data, now)
    if isinstance(state, Watching) and data.turn and data.turn.status == "completed":
        return Stopped(data, "idle-task")
    return state


def observe_user(data: Session, user: UserMessage) -> Session | None:
    if user.item_id not in data.known_users and user.client_id not in data.own_clients:
        return None
    return replace(data, known_users=data.known_users | {user.item_id})


def step(state: State, event: Event, now: float) -> Transition:
    if isinstance(state, Stopped):
        return state, ()
    data = state.data
    if isinstance(event, Stop):
        return Stopped(data, event.reason), ()
    if now >= data.expires:
        return Stopped(data, "expired"), ()
    if isinstance(event, UserSubmitted):
        updated = observe_user(data, event.user)
        if updated is None:
            return Stopped(data, "manual-prompt"), ()
        return replace(state, data=updated), ()
    if isinstance(event, GoalChanged):
        reason = goal_stop(data, event.goal)
        data = replace(data, goal=event.goal, blocked_turn=event.turn_id)
        if reason:
            return Stopped(data, reason), ()
        if event.goal and event.goal.status == "blocked":
            if event.turn_id is None:
                return Stopped(data, "goal-blocked"), ()
            if data.turn and data.turn.turn_id == event.turn_id and data.turn.status == "completed":
                return Stopped(data, "goal-blocked"), ()
        return replace(state, data=data), ()
    if isinstance(event, TurnChanged):
        turn = event.turn
        if turn.turn_id in data.finished and (
            data.turn is None or data.turn.turn_id != turn.turn_id
        ):
            return state, ()
        for user in turn.users:
            updated = observe_user(data, user)
            if updated is None:
                return Stopped(data, "manual-prompt"), ()
            data = updated
        if data.turn and turn.turn_id == data.turn.turn_id and data.turn.status == turn.status:
            return replace(state, data=data), ()
        if turn.status != "inProgress":
            data = replace(data, finished=data.finished | {turn.turn_id})
        data = replace(data, turn=turn)
        return failure_state(data, now), ()
    if isinstance(event, Tick):
        if isinstance(state, Backoff) and now >= state.until:
            return Recovering(data, state.failed_turn), (Recheck(state.failed_turn),)
        return state, ()
    if not isinstance(state, Recovering) or state.sent:
        return state, ()
    if event.failed_turn != state.failed_turn:
        return state, ()
    snapshot = event.snapshot
    if snapshot.queued:
        return Stopped(data, "manual-prompt"), ()
    reason = goal_stop(data, snapshot.goal)
    if reason:
        return Stopped(data, reason), ()
    if not event.pane_valid:
        return Stopped(data, "pane-changed"), ()
    if snapshot.interactive:
        return Stopped(data, "interactive-request"), ()
    if snapshot.thread_status != "idle" or snapshot.turn is None:
        return Stopped(data, "recheck-changed"), ()
    turn = snapshot.turn
    if (
        turn.turn_id != state.failed_turn
        or turn.status != "failed"
        or turn.error not in RECOVERABLE
    ):
        return Stopped(data, "recheck-changed"), ()
    for user in turn.users:
        updated = observe_user(data, user)
        if updated is None:
            return Stopped(data, "manual-prompt"), ()
        data = updated
    if turn.turn_id in data.attempted:
        return Stopped(data, "already-attempted"), ()
    client_id = event.client_id if data.intent is None else None
    data = replace(
        data,
        goal=snapshot.goal,
        turn=turn,
        attempted=data.attempted | {turn.turn_id},
        own_clients=data.own_clients | ({client_id} if client_id else set()),
        retries=data.retries + 1,
    )
    return Recovering(data, turn.turn_id, True), (
        Mutation(turn.turn_id, client_id, data.intent is not None),
    )
