# Porting contract

Conventions `formats/claude.py` and `formats/codex.py` follow, matching the behaviour
of a Rust reference implementation. The goal is **byte-level output parity** with that
reference. Follow these exactly; where a rule surprises you, the reason is given.

This file records the Python mechanics the core modules provide so the format writers
compose cleanly.

## Layout

```text
src/handoff/
  __init__.py        package marker, __version__, re-exports CURRENT_IR_VERSION
  errors.py          HandoffError, ctx(), bail()
  _ids.py            uuid helpers (v4, v4-simple, v7 fallback, is_uuid, normalize_uuid)
  _json.py           datetime parse/format, key-sort, compact/pretty dumps, write_json_line
  ir.py              IR types + to_json_dict/from_json_dict (DONE)
  formats/__init__.py  detect/resolve/load/write dispatch (DONE)
  formats/claude.py    load()/write()  <-- port me
  formats/codex.py     load()/write()  <-- port me
  cli.py               owned by the CLI agent (main())
```

## Error strategy (`errors.py`)

The Rust uses `anyhow`. This port maps it onto one exception plus a context helper.

- **`HandoffError(Exception)`** is the only error type public functions raise. It is
  the analogue of `anyhow::Error`: the top message is the outermost context, `__cause__`
  walks the wrapped chain.
- **`bail(msg)`** == `bail!(msg)`: `raise HandoffError(msg)` with no cause.
- **`ctx(message)`** == `.with_context(|| ...)` / `.context(...)`: a context manager that
  re-raises any exception from its block as a `HandoffError(message)` chained via
  `from exc`. Pass a `lambda` for the closure form (evaluated only on failure), a `str`
  for the eager form.

Wrap every stdlib boundary failure (`OSError`, `json.JSONDecodeError`,
`UnicodeDecodeError`, `sqlite3.Error`) in `ctx`, mirroring each Rust `.with_context`
call site. Do not let raw stdlib exceptions escape `load`/`write`.

```python
from ..errors import ctx, bail

with ctx(lambda: f"failed to open Codex session {path}"):
    text = path.read_text(encoding="utf-8")
```

## JSON conventions (`_json.py`) — the parity core

The Rust depends on `serde_json` **without `preserve_order`**, so `serde_json::Value`
(and the `json!` macro) is backed by a `BTreeMap`. Consequences, and how to reproduce
them:

1. **Free-form JSON objects serialise with keys sorted lexicographically, recursively.**
   Every line the JSONL writers build via `json!` is a `Value`, so *the literal key
   order in the Rust source is irrelevant to the output* — it is re-sorted. So you can
   build your line dicts in any readable order and rely on sorting.
   - Use **`dumps_compact(value)`** for JSONL lines: `json.dumps` with
     `sort_keys=True`, `ensure_ascii=False`, `separators=(",", ":")`. Matches
     `serde_json::to_writer`.
   - Use **`write_json_line(stream, value)`** to emit one compact line + `"\n"` (the Rust
     `write_json_line` helper). Open files in text mode with `encoding="utf-8"` and
     `newline="\n"`.

2. **IR struct fields keep declaration order** (serde derive), but their embedded
   free-form values are still sorted. `ir.py` already handles this; you will not
   re-serialise IR structs from the writers.

3. **Encoding**: `ensure_ascii=False` (serde writes raw UTF-8, never `\u` escapes for
   non-ASCII). Compact separators are `,` and `:` with no spaces.

4. **No trailing newline** on the pretty IR file (`fs::write` of the pretty string).
   `write_ir` already does this; JSONL lines each end in exactly one `\n`.

Helpers you will reuse:

- `dumps_compact(value) -> str`, `write_json_line(stream, value)` — JSONL emission.
- `sort_value(value)` — recursively key-sort an arbitrary JSON value (rarely needed
  directly in writers, since `dumps_compact` sorts; use if you must compare/build sorted
  intermediates).
- `now_utc()` — `Utc::now()`.

### Timestamps

- **`parse_datetime(s) -> datetime | None`** == `DateTime::parse_from_rfc3339(s).ok()
  .map(with_timezone(Utc))`. Returns an aware UTC datetime, or `None` on failure.
- **`format_millis(dt) -> str`** == `to_rfc3339_opts(SecondsFormat::Millis, true)`:
  always 3 fractional digits + `Z`. **Use this for every timestamp the JSONL writers
  emit** — both `claude.rs` and `codex.rs` use `SecondsFormat::Millis`.
- **`format_auto(dt) -> str`** == `chrono`'s default `DateTime` serde encoding
  (0/3/6-digit fraction + `Z`). Used by `ir.py` for `created_at`/`updated_at`; you
  probably will not need it in the writers.
- Timestamp-milliseconds (Claude history `timestamp`) == Rust `timestamp_millis()`; use
  **`timestamp_millis(dt)`**, which does exact integer arithmetic. Do not use
  `int(dt.timestamp() * 1000)`: the float multiply lands 1ms low for some
  millisecond-aligned instants. Unix seconds for Codex SQLite == `int(dt.timestamp())`
  (Rust `timestamp()`).

**Deviation to know:** Python datetimes are microsecond-resolution; RFC 3339 inputs with
7-9 fractional digits are truncated to microseconds on parse. Fixtures use milliseconds,
so this does not bite them.

## UUID helpers (`_ids.py`)

Python stdlib gained `uuid.uuid7()` only in 3.14; this port targets >=3.12, so a
hand-rolled RFC 9562 v7 is used unconditionally.

- `new_uuid4() -> str` == `Uuid::new_v4().to_string()` (hyphenated lowercase).
- `new_uuid4_simple() -> str` == `Uuid::new_v4().simple()` (32 hex, no hyphens) — for
  Claude `msg_{...}` ids.
- `new_uuid7() -> str` == `Uuid::now_v7().to_string()` — Codex session/turn/call ids.
- `is_uuid(s) -> bool` == `Uuid::parse_str(s).is_ok()`.
- `normalize_uuid(s) -> str | None` == `Uuid::parse_str(s).map(|u| u.to_string()).ok()`.

The Rust `codex_session_id` returns the candidate unchanged when it is a valid UUID
else a fresh v7; `claude_session_id` normalises a valid UUID (lowercase hyphenated) else
a fresh v4. Reproduce with `is_uuid` / `normalize_uuid` + `new_uuid7` / `new_uuid4`.

## IR API (`ir.py`) — what the writers consume/produce

`CURRENT_IR_VERSION = "handoff/v1"`.

Enums (`StrEnum`, values are the serde `snake_case` strings):
`SessionFormat` = `IR|CODEX|CLAUDE`; `SourceFormat` = `AUTO|IR|CODEX|CLAUDE` with
`.explicit() -> SessionFormat | None`.

Types (import from `handoff.ir`):

- `UniversalSession(ir_version, metadata, events)` — **mutable**; `UniversalSession.new(session_id)`
  builds a fresh one (current version, empty events). `.to_json_dict()` / `.from_json_dict(d)`.
- `SessionMetadata(...)` — **mutable** (loaders mutate it line-by-line, like `&mut`).
  Fields, in serde order: `session_id`, `source_format`, `original_session_id`, `title`,
  `cwd` (str), `git_branch`, `model`, `platform_version`, `created_at`, `updated_at`,
  `extra` (dict). `SessionMetadata.new(session_id)`.
- Events are **frozen** dataclasses (construct once, then append):
  - `MessageEvent(role, id=None, parent_id=None, timestamp=None, blocks=[], metadata={})`
  - `ReasoningEvent(id=None, parent_id=None, timestamp=None, summary=[], metadata={})`
  - `ToolCallEvent(call_id, name, id=None, parent_id=None, timestamp=None, arguments=None, metadata={})`
  - `ToolResultEvent(call_id, output=None, is_error=False, id=None, parent_id=None, timestamp=None, metadata={})`
  - Each carries a `KIND` class attr and `.to_json_dict()`; module helpers
    `event_to_json_dict`, `event_from_json_dict`, `event_timestamp(event)`.
- `ContentBlock(kind, text=None, data=None)` — frozen; `ContentBlock.make_text(kind, text)`
  == `ContentBlock::text(...)`. To mutate (e.g. Claude's `project_message_for_claude`
  prefix injection), use `dataclasses.replace(block, text=...)`.

`arguments`/`output`/`data` and the `extra`/`metadata` maps hold arbitrary JSON
(`type JsonValue`). Store parsed `json.loads` output directly. `ir.py` sorts them on
serialisation, matching `serde_json::Value`.

## Load / write signatures — how they compose

`formats/__init__.py` (done) dispatches to your modules. **Do not change these
signatures**; `formats/__init__.py` and `cli.py` depend on them:

```python
# handoff/formats/claude.py  and  handoff/formats/codex.py
def load(path: pathlib.Path) -> UniversalSession: ...
def write(session: UniversalSession, output: pathlib.Path) -> pathlib.Path: ...
```

- `load(path)` reads one native session file into a `UniversalSession`.
- `write(session, output)` materialises and **returns the primary session file path**.
  `output` is either a `.jsonl` file (write standalone; skip index/history/sqlite
  sidecars per the Rust `plan_output`) or a home directory (full native layout).

`formats/__init__.py` already exposes, for `cli.py` and tests:
`detect_format`, `resolve_input`, `load_session`, `write_ir`, `load_ir`, `materialize`,
`default_output_root`, `codex_root`, `claude_root`, and `ResolvedInput(path, format)`.

## Key-ordering rules — summary

| What | Order | Mechanism |
|---|---|---|
| IR struct fields (`UniversalSession`, `SessionMetadata`, events, `ContentBlock`) | declaration order | `ir.py` `to_json_dict` (done) |
| `SessionEvent` tag | `kind` emitted first | `ir.py` (done) |
| `extra`, event `metadata`, and every free-form JSON object (JSONL lines, `data`, `arguments`, `output`) | **sorted keys, recursive** | `dumps_compact(sort_keys=True)` / `sort_value` |
| `Option`/`None` fields | omitted | `to_json_dict` skips `None` |
| empty `extra`/`metadata` | omitted | `to_json_dict` skips falsy maps |

## Not in scope for the scaffold

`cli.py` (subcommands `inspect|import|export|convert` + the default quick-convert, the
resume/open behaviour, `maybe_rekey_session`) is a separate agent. The scaffold exposes
everything it imports from `formats`/`ir`.
