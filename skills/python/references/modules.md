# Modules, packages, and imports

## Deep modules

A deep module hides substantial behaviour behind a cohesive, low-burden
interface - not necessarily few functions, since one concept can carry a dozen
cohesive combinators and still be deep. Avoid modules that forward calls or
mirror tables. Deletion test: deleting a pass-through module makes complexity
vanish; deleting one that earned its keep spreads complexity across callers.

## Package layout

`src/<distribution>/<context>/` - one package per bounded context, named in the
ubiquitous language (`billing`, `invitations`, `allocation`). The `src` layout
makes tests import the installed package, so a packaging mistake fails the run.

Slice by concept, not by technical layer. `models.py`, `services.py` and
`schemas.py` are layer slicing wearing filenames: every feature change touches
all three and no file states a concept. `utils.py`, `helpers.py` and `common.py`
name nothing, so they accrete and nothing in them is safely deletable. A helper
that mentions a domain noun gets a module named after that noun.

## The public surface

`__init__.py` is the package's interface and the only surface another package
imports; everything else is `_module.py` or `_name`. Mark the public set the two
ways a type checker recognises - `__all__`, or a redundant `X as X` re-export:

```python
# src/app/billing/__init__.py - the package's whole public surface
from app.billing._invoice import Invoice as Invoice, parse_invoice as parse_invoice

__all__ = ["Invoice", "parse_invoice"]
# `from app.billing._ledger import recompute` is a boundary violation, not a shortcut.
```

Without one of those marks, a plain `from app.billing._invoice import Invoice` in
`__init__.py` re-exports nothing as far as the checker is concerned, and every
consumer gets `warning: "Invoice" is not exported from module "app.billing"
(reportPrivateLocalImportUsage)` - which fires with no `py.typed` marker anywhere
in the package, and fails the run because `recommended` fails on warnings. Its
hint says to import from `app.billing._invoice`, the opposite of the fix; mark
the export. Two limits before leaning on the checker:

- It polices private **names**, not private **module names**. An underscore
  function used outside its module is `reportPrivateUsage`; a deep import of
  `app.billing._ledger` is invisible, and needs an import-linter `protected`
  contract (`mechanical-enforcement`).
- `__init__.py` re-exports are execution, not indirection: `import app.billing`
  runs `_invoice.py` because the `__init__` names it, and not `_ledger.py`. A fat
  `__init__.py` is startup cost, a circular-import surface, and defeats lazy loading.

## Imports

- Absolute throughout. Ruff's `TID252` bans relative imports from *parent*
  modules by default, so `from .sibling import x` passes unflagged;
  `ban-relative-imports = "all"` bans both (config: `mechanical-enforcement`).
- Import from a package's public surface, never another package's `_module.py`.
- No `from x import *` - it makes the surface unreadable and hides shadowing.

## No import-time side effects

`import` executes the file top to bottom, once, and caches the result in
`sys.modules`, so a module-level constant that touches the world is three
problems wearing one line:

```python
CLIENT = httpx.Client(base_url=os.environ["URL"])   # not a constant
```

It reads config at import, opens a resource nothing will close, and becomes a
process-wide singleton no test can replace. Build it in the composition root
instead (`ports-persistence.md`). Pin the rule with the cheapest gate there is:

```python
import pkgutil
import subprocess
import sys

import pytest

import app


def _reraise(name: str) -> None:
    # Without this, a package whose __init__ raises ImportError loses its subtree silently.
    raise RuntimeError(f"discovery failed at {name}")


MODULES = [m.name for m in pkgutil.walk_packages(app.__path__, f"{app.__name__}.", onerror=_reraise)]


@pytest.mark.parametrize("name", MODULES)
def test_module_imports_alone_in_an_empty_environment(name: str) -> None:
    # In-process, sys.modules caches the first order that worked and hides a cycle.
    result = subprocess.run(
        [sys.executable, "-c", f"import {name}"],  # a fresh interpreter per module
        env={"PYTHONPATH": ":".join(sys.path)},  # no other variable is set
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
```

One false-positive class: modules whose *job* is module-level registration - plugin
entry points, `@app.route` handlers, ORM metadata. Scope the test to inert packages.

## TYPE_CHECKING imports and their cost

`if TYPE_CHECKING:` removes the runtime import, not the coupling: import-linter still
counts the edge - a `forbidden` contract breaks at the line inside the guard - and
basedpyright still reports the cycle. It changes *when* an unimportable annotation fails:

- On 3.12 and 3.13, an unquoted `amount: Decimal` under a `TYPE_CHECKING`-only
  import raises `NameError` at class definition - loud, immediate, local.
- On 3.14, PEP 649 makes annotations lazy: the class builds and the `NameError`
  arrives at first resolution - `get_type_hints(Row)` raises it, and pydantic 2.13.5
  raises `PydanticUserError: 'Row' is not fully defined` at the first validation.

So the rule is about the consumer, not the syntax: any annotation something
resolves at runtime - pydantic, FastAPI, `dataclasses` plus `get_type_hints` -
must be importable at runtime. Reserve `TYPE_CHECKING` for the rest.

`annotationlib` (3.14) reads such annotations without resolving them, where
`get_type_hints` raises: for `amount: Decimal`, `Format.FORWARDREF` yields
`ForwardRef('Decimal')` and `Format.STRING` yields `'Decimal'`. It serves a
library inspecting somebody else's annotations, not your own unresolvable ones.

Where a layer may reference another's types but not import them at runtime, ruff's
`TID253` is that split - the `TYPE_CHECKING` import passes, the module-level one
fails (config: `mechanical-enforcement`).

## Breaking circular imports

Three fixes:

1. **Invert.** Define the `Protocol` the consumer needs in the *consumer's*
   package; the provider satisfies it structurally with no import back - the same
   inversion `ports-persistence.md` makes for SQLAlchemy.
2. **Extract a third module.** The concept both packages reach for is its own
   module, and both depend on it.
3. **Merge.** Two modules that always change together and reference each other
   are one module pretending to be two.

Three non-fixes:

- **A function-local import.** Ruff flags it (`PLC0415`), basedpyright still
  reports the cycle, import-linter still counts the edge; it moves the failure to
  first call and hides the dependency from every reader.
- **A `TYPE_CHECKING` guard on the back-edge.** Still a cycle to basedpyright,
  still an edge to import-linter, and on 3.14 it relocates the `NameError` to
  first resolution rather than removing it.
- **Reordering `__init__.py`.** The same two files import cleanly or raise
  `ImportError: cannot import name 'VERSION' from partially initialized module`
  depending on which line comes first, with an identical cycle diagnostic either way -
  it changes which order happens to work, not the graph.

The commonest legitimate-looking shape that fires: `pkg/__init__.py` re-exports a
submodule that reads `VERSION` or settings back from its own package.

## Enforceable boundaries

Name the boundary in domain language first, then encode it. Good names read like
invariants: `domain-does-not-reach-infrastructure`, `contexts-are-independent`.
One owner per job, so two tools never half-express the same rule:

| Boundary shape | Owner |
|---|---|
| The module graph - layers, forbidden edges, protected internals, independence, package cycles; `TYPE_CHECKING`-inclusive by default | import-linter |
| Attribute-level effect bans inside the pure core | ruff `TID251` |
| Module-level versus type-only imports of one package | ruff `TID253` |
| File-level import cycles | basedpyright |
| Anything call-shaped or file-scoped | ast-grep |

Configuration for all five lives in `mechanical-enforcement`
(`references/python.md`, `python-import-linter.toml`, `python-ruff.toml`,
`python-ast-grep.yml`), with the per-contract-type chain rules and each tool's
fail-open traps. One counter-intuitive trap: basedpyright reports import cycles
under `typeCheckingMode = "recommended"` and `"all"`, is silent under `"strict"`
and `"standard"`, so tightening the mode drops the cycle gate.
