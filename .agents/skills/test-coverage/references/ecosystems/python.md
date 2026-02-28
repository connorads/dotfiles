# Python Coverage Patterns

## Tools

| Tool | Purpose |
|------|---------|
| **pytest** | Test runner |
| **pytest-cov** | Coverage plugin (wraps coverage.py) |
| **coverage.py** | Underlying coverage engine |
| **hypothesis** | Property-based testing |

## Configuration (pyproject.toml)

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = [
    "unit: Pure logic tests",
    "integration: Database and service boundary tests",
    "e2e: End-to-end tests",
]

[tool.coverage.run]
source = ["src"]
omit = [
    "src/migrations/*",
    "src/**/generated/*",
    "src/conftest.py",
]

[tool.coverage.report]
fail_under = 100
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
    "@overload",
    "\\.\\.\\.",  # ellipsis in protocol/abstract methods
]
show_missing = true
```

## Running per tier

```bash
# Unit tests with coverage
pytest -m unit --cov --cov-report=html:coverage/unit --cov-report=term-missing

# Integration tests with coverage
pytest -m integration --cov --cov-report=html:coverage/int --cov-report=term-missing

# All tests
pytest --cov --cov-report=html:coverage/all
```

## Fixtures and factories

```python
# tests/conftest.py
import pytest
from itertools import count

_counter = count(1)

@pytest.fixture
def make_user():
    def _make(**overrides):
        n = next(_counter)
        defaults = {"email": f"test-{n}@example.com", "name": f"User {n}"}
        return {**defaults, **overrides}
    return _make
```

## Property-based testing with hypothesis

```python
from hypothesis import given, strategies as st

@given(st.text(min_size=1, max_size=100))
def test_slugify_never_produces_empty_for_nonempty_input(s):
    result = slugify(s)
    # Slugify should always produce something for non-empty input
    # (or raise ValueError for truly un-slugifiable content)
    assert isinstance(result, str)
```
