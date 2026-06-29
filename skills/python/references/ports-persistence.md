# Ports, persistence, and dependency injection

## Protocol vs ABC for ports

Default to a `typing.Protocol` — structural typing means an adapter satisfies the
port by shape, with no explicit subclassing, and the port can name the *narrowest*
slice a caller needs:

```python
from typing import Protocol

class BatchRepository(Protocol):
    def add(self, batch: Batch) -> None: ...
    def get(self, reference: Reference) -> Batch | None: ...
```

Reach for `abc.ABC` only when you want nominal enforcement or shared behaviour.
Be honest about the cost the book observed: ABCs tend to rot and get deleted in
practice while duck typing carries the port. For a single-method dependency, a
plain `Callable` is a perfectly good port — reserve a `Protocol`/ABC for a
genuinely multi-method one (read + write).

## Persistence ignorance

Keep domain classes as plain Python objects with **no ORM base class** and no
persistence methods. With SQLAlchemy, prefer the imperative (classical) mapper so
the mapping points the database at the model:

```text
ORM / table metadata  ->  imports and maps  ->  plain domain model
```

so *your ORM imports your model, not the reverse* — the dependency inverts the way
`architecture` wants. A `Repository` is the persistence port that presents stored
aggregates as an in-memory collection (`add`/`get`); a `Unit of Work` is the
transaction boundary that bundles repositories under one atomic commit.

Link aggregates by id, never by embedding:

```python
@dataclass
class Document:
    workspace_id: int      # reference, not workspace: Workspace
    parent_folder: int
```

### The SELECT N+1 gotcha

Lazy-loaded ORM object graphs fire a query on *every dotted attribute access*, so
a nested loop over `account.workspaces[...].documents` can explode into hundreds
of queries. On read-heavy paths reach for eager loading (`selectinload`/`joinedload`)
or drop to a single hand-written SQL query — this is the first step toward a CQRS
read model (`architecture`).

## Dependency injection and bootstrapping

Prefer explicit injection over monkeypatching imports. `mock.patch("module.send")`
couples the test to the exact import form and breaks on a trivial refactor; an
explicit dependency you can pass a fake to does not.

Wire everything in one **composition root** — a `bootstrap()` in the entrypoint
that constructs real adapters, injects them, and returns the configured app. It
is also the single place a test substitutes fakes:

```python
def bootstrap(
    uow: AbstractUnitOfWork = SqlAlchemyUnitOfWork(),
    notifications: Notifications = EmailNotifications(),
) -> MessageBus:
    ...
```

Compose a handler with its dependencies via a closure or `functools.partial`:

```python
allocate_composed = partial(allocate, uow=uow)      # or: lambda cmd: allocate(cmd, uow)
```

Mind late binding — a named `def` beats a `lambda` for stack traces, and a `lambda`
capturing a loop variable binds late. Keep production defaults in the bootstrap
signature; default a dependency to `None` and build it inside when constructing
the real one has import-time side effects. Don't reach for a DI framework until
dependencies have their own chained dependencies; below that it is
overengineering.

## Resource and transaction boundaries

A context manager is the syntactic carrier of a scope. Make the Unit of Work
safe by default — commit only on explicit success, roll back on any exit:

```python
class SqlAlchemyUnitOfWork(AbstractUnitOfWork):
    def __enter__(self) -> "SqlAlchemyUnitOfWork":
        self.session = self.session_factory()
        return self

    def __exit__(self, *args: object) -> None:
        self.session.rollback()   # no-op after an explicit commit; safe default
        self.session.close()

    def commit(self) -> None:
        self.session.commit()
```

The only path that persists is total success plus an explicit `commit()`; any
exception or early return leaves the default rollback in force. Own resource
creation and cleanup in the shell; no import-time side effects.
