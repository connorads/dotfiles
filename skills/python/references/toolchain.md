# Toolchain: choosing and pinning an interpreter

The fastest-moving facts in the skill - re-verify the dated blocks when revising (done
2026-09-02 on CPython 3.11.15 through 3.15.0rc1, 3.14.7 in both GIL and free-threaded
builds, uv 0.12.7, ruff 0.16.5, pydantic 2.13.5 / 1.10.24 / 1.10.26). Scope fence:
interpreter *version selection and runtime management* live here; ruff, basedpyright and
pytest config stay with `mechanical-enforcement`.

## The floor and the default

**Floor 3.12. Default 3.14.** Every snippet in this skill uses PEP 695 syntax (`def
f[T]`, `type Alias = ...`), a `SyntaxError` on 3.11 - that fixes the floor, not taste.
State the floor once, here; other pages carry no version arms.

Devguide support status: 3.10 security-only, end of life 2026-10; 3.11 to 2027-10; 3.12
to 2028-10; 3.13 and 3.14 the bugfix lines, to 2029-10 and 2030-10. python.org ships a
security-only line as source only, so its patches arrive through a redistributor build
(uv's python-build-standalone, the distro package) - a supply route to check, not a
reason to raise the floor, since uv installs a prebuilt 3.12 today.

## Idiom to minimum version

| Available from | What it buys |
|---|---|
| 3.11 (present at the floor) | `enum.StrEnum`, `asyncio.TaskGroup`, `asyncio.timeout`, `ExceptionGroup` and `except*`, `typing.LiteralString` |
| 3.12 (the floor) | PEP 695 generics - `def f[T]`, `class C[T]`, `type Alias = ...` - and `typing.override` |
| 3.13 | `typing.TypeIs`, `typing.ReadOnly`, `warnings.deprecated`, `TypeVar(default=...)`, `Queue.shutdown` on both `queue.Queue` and `asyncio.Queue` |
| 3.14 | PEP 649 lazy annotations and `annotationlib`, t-strings (`string.templatelib.Template`), `except A, B` without parentheses, `concurrent.futures.InterpreterPoolExecutor` |

`typing_extensions` (4.16.0) is the single backport carrier: on 3.12 it supplies
`TypeIs`, `ReadOnly`, `deprecated`, `override` and `TypeForm`. Import from `typing`
where the floor has the feature and `typing_extensions` where it does not, rather than a
version branch.

## Deferred annotations: delete `from __future__ import annotations` on 3.14

Under PEP 649/749 an annotation is evaluated at first use, so a forward reference needs
neither quotes nor a rebuild call:

```python
from pydantic import BaseModel

class Order(BaseModel):
    lines: tuple[Line, ...]   # Line is defined below; no quotes, no future import

class Line(BaseModel):
    sku: str

Order(lines=[{"sku": "a"}])   # 3.14: lines=(Line(sku='a'),)
```

On 3.13 and below the same file raises `NameError: name 'Line' is not defined` at
class-body execution. The future import opts a module into PEP 563 strings, the slower
path for every runtime consumer of annotations: `Order.__annotations__` holds source
strings rather than real objects, and a model defined inside a function,
forward-referencing a class defined later in it, fails with `PydanticUserError: 'Order'
is not fully defined` (pydantic 2.13.5). Keep the import only in a module that must also
run on 3.13 or below; it is not deprecated, and 3.13 lives to 2029-10.

Two things deletion does not buy. A name imported only under `TYPE_CHECKING` still fails
when something resolves the annotation, so keep runtime-resolved annotations importable
(`modules.md`). And no lint rule removes it - `UP010` retires only a feature the target
version absorbed, `FA100`/`FA102` flag its *absence*, `PYI044` is stubs-only - so
deletion is a review or codemod job.

## uv owns the runtime

`requires-python` in `pyproject.toml` is the contract other tools read: with it at
`">=3.12"` and no `target-version`, ruff 0.16.5 resolves
`linter.unresolved_target_version = 3.12`. `uv python install 3.14` fetches the
interpreter and `uv python pin 3.14` writes `.python-version` for this working copy. The
pin can only narrow the contract, never contradict it - against `requires-python =
">=3.14"`, `uv python pin 3.12` exits 2, naming the incompatibility with the project's
`requires-python`.

**`uv sync --frozen` is not a drift gate.** With a dependency added to `pyproject.toml`
and the lockfile left stale, `uv lock --check` and `uv sync --locked` both exit 1 naming
the lockfile; `uv sync --frozen` exits 0, installs the stale set, and the dependency is
simply absent. Use `--frozen` in an image build already gated and `uv lock --check` as
the gate (placement: `mechanical-enforcement`). Where a repo pins tools with another
manager (mise, asdf), leave the pin file to that manager and keep `requires-python` as
the contract; two rival pins is the failure, not the choice of manager.

## Free-threading

The free-threaded build is a separate interpreter (`python3.14t`), identified by
`sysconfig.get_config_var("Py_GIL_DISABLED") == 1`. Officially supported since 3.14 (PEP
779); the design rules are unchanged - shared mutable state needs a lock, structured
concurrency owns task lifetime (`concurrency.md`).

**One C extension that has not declared `Py_mod_gil` re-enables the GIL for the whole
process**, announced only by a one-line `RuntimeWarning` on stderr at import time, and
`PYTHON_GIL=0` keeps the GIL off while removing that warning too. Assert the state:

```python
import sys
assert sys._is_gil_enabled() is False, "a C extension re-enabled the GIL"
```

Run that at startup on a free-threaded deployment only - on a GIL build the same
assertion fires with a message that names the wrong cause. Spell the variant when
requesting an interpreter: `3.14t` selects the free-threaded build, `3.14+gil` requires
the GIL build. A bare `3.14` is not a reliable way to avoid free-threading, because uv
0.12.7 ranks the newest **uv-managed** version first and only then prefers the GIL
build - a free-threaded 3.14.7 beside a uv-managed GIL 3.14.3 wins `uv python find
3.14`; a uv-managed GIL 3.14.7 takes it back, one owned by another manager does not.

## Library facts (as of 2026-09)

| Package | Version | Released | Note |
|---|---|---|---|
| pydantic | 2.13.5 | 2026-08-28 | boundary parser (`parsing.md`) |
| pydantic-settings | 2.15.0 | 2026-08-07 | settings at the composition root (`ports-persistence.md`) |
| msgspec | 0.21.1 | 2026-04-12 | ships cp314 wheels |
| attrs | 26.1.0 | 2026-03-19 | validators, converters, `cached_property` on a slotted class |
| stamina | 26.1.0 | 2026-04-13 | retries in the adapter (`ports-persistence.md`) |
| anyio | 4.14.2 | 2026-07-12 | task groups across asyncio and Trio |
| typing-extensions | 4.16.0 | 2026-07-02 | the backport carrier |

**pydantic V1 needs 1.10.25 before 3.14, and below it fails open.** 1.10.25 (2025-12-18)
adds minimal 3.14 support; on 1.10.26, the current V1 line, a model imports, validates
and warns nothing there. The 1.10.24 wheel and below import the same model on 3.14 with
`UserWarning: Core Pydantic V1 functionality isn't compatible with Python 3.14 or
greater`, then drop every annotation-only field, required ones included - construction
succeeds, no rule runs, and unvalidated data reaches the core instead of a crash. It is
intact on 3.13. A repo on V1 raising its floor to 3.14 pins `pydantic>=1.10.25` in the
same change; the `pydantic.v1` module inside V2 works on 3.14.

**Result libraries.** `returns` 0.29.0 (2026-08-02, Development Status 4 - Beta,
`>=3.11`) carries a **mypy plugin** delivering `curry`, `do_notation`, `flow`, `kind`,
`partial` and `pipe`; pyright/basedpyright has no plugin API, so under the basedpyright
gate `mechanical-enforcement` specifies those six lose their inference - `@safe` types
correctly there without it. `expression` 5.7.0 (2026-08-15, Production/Stable, `>=3.10`)
is the checker-agnostic alternative; `rustedpy/result` last shipped 0.17.0 in June
2024 - do not pick it. The default under a basedpyright gate stays the hand-rolled
`Ok | Err` union in `errors.md`.

## Watch (as of 2026-09)

Python 3.15 is scheduled for 2026-10-01, rc2 2026-09-01 (PEP 790). Four items touch this
skill; all four PEPs are Final, and the behaviour below is 3.15.0rc1:

- **PEP 810 `lazy import`** - module level only: `lazy import json` and `lazy from json
  import dumps` run at module scope, while the same statement in a function, a class body or
  a `try` block is a `SyntaxError`, as is `lazy from json import *`. The sanctioned way to
  keep a composition root's import cost down, replacing the function-local import `PLC0415`
  flags.
- **PEP 728 `closed=` / `extra_items=` TypedDicts** - closes the checker-conditional gap
  `modeling.md` notes for the stdlib spelling.
- **PEP 747 `TypeForm`** - a precise signature for a function taking a type expression as a
  value, the shape most parse helpers have.
- **PEP 686 UTF-8 mode by default** - `sys.flags.utf8_mode` is 1 with nothing set in the
  environment, `PYTHONUTF8=0` restores locale encoding, and an explicit `encoding=` on every
  `open()` stays right while the code must also run on 3.14 or below.

Also on rc1: a `frozendict` builtin (PEP 814), a `sentinel` builtin class (PEP 661),
unpacking in comprehensions (PEP 798). Re-verify this section at release.
