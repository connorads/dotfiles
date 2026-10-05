"""Content-free values shared by the recovery engine and its adapters."""

from dataclasses import dataclass
from typing import Literal

type TurnStatus = Literal["inProgress", "completed", "failed", "interrupted"]
type GoalStatus = Literal[
    "active", "paused", "blocked", "complete", "usageLimited", "budgetLimited"
]
type ThreadStatus = Literal["idle", "active", "notLoaded", "systemError"]


@dataclass(frozen=True)
class UserMessage:
    item_id: str
    client_id: str | None


@dataclass(frozen=True)
class Turn:
    turn_id: str
    status: TurnStatus
    error: str | None = None
    users: tuple[UserMessage, ...] = ()


@dataclass(frozen=True)
class GoalIntent:
    objective_hash: str
    token_budget: int | None
    created_at: int


@dataclass(frozen=True)
class Goal:
    intent: GoalIntent
    status: GoalStatus
    tokens_used: int


@dataclass(frozen=True)
class Snapshot:
    thread_status: ThreadStatus
    interactive: bool
    turn: Turn | None
    goal: Goal | None
    queued: bool = False


RECOVERABLE = frozenset(
    {
        "cyberPolicy",
        "serverOverloaded",
        "httpConnectionFailed",
        "responseStreamConnectionFailed",
        "responseStreamDisconnected",
        "responseTooManyFailedAttempts",
    }
)
