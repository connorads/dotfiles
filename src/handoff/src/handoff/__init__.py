"""handoff: translate session history between Claude Code, Codex, and a portable IR.

The package is deliberately import-light at the top level (no `cli` import here) so
`import handoff` stays cheap and free of optional-command dependencies.
"""

from __future__ import annotations

__all__ = ["__version__", "CURRENT_IR_VERSION"]

__version__ = "0.1.3"

from .ir import CURRENT_IR_VERSION
