# Go Coverage Patterns

## Built-in coverage

```bash
# Run tests with coverage profile
go test -coverprofile=coverage/unit.out ./...

# View coverage in terminal
go tool cover -func=coverage/unit.out

# Generate HTML report
go tool cover -html=coverage/unit.out -o coverage/unit.html

# Check total coverage
go tool cover -func=coverage/unit.out | grep total:
```

## Per-package thresholds

```bash
#!/usr/bin/env bash
# scripts/check-coverage.sh
THRESHOLD=90
COVERAGE=$(go test -coverprofile=coverage.out ./... 2>&1 | grep -oP 'coverage: \K[0-9.]+')
if (( $(echo "$COVERAGE < $THRESHOLD" | bc -l) )); then
  echo "Coverage $COVERAGE% below threshold $THRESHOLD%"
  exit 1
fi
```

## Integration tests with build tags

```go
//go:build integration

package store_test

import (
    "testing"
    "database/sql"
)

func TestCreateUser(t *testing.T) {
    db := setupTestDB(t)
    defer db.Close()
    // ...
}
```

```bash
# Run only integration tests
go test -tags=integration -coverprofile=coverage/int.out ./...

# Run only unit tests (default, no build tag)
go test -coverprofile=coverage/unit.out ./...
```

## gotestsum for better output

```bash
# Install
go install gotest.tools/gotestsum@latest

# Run with structured output
gotestsum --format=short -- -coverprofile=coverage.out ./...
```

## Table-driven tests (idiomatic Go coverage)

```go
func TestSlugify(t *testing.T) {
    tests := []struct {
        name  string
        input string
        want  string
    }{
        {"spaces to hyphens", "hello world", "hello-world"},
        {"already clean", "hello", "hello"},
        {"empty string", "", ""},
        {"special chars", "hello!@#world", "helloworld"},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := slugify(tt.input)
            if got != tt.want {
                t.Errorf("slugify(%q) = %q, want %q", tt.input, got, tt.want)
            }
        })
    }
}
```

## Profile merging

```bash
# gocovmerge for multiple profiles
go install github.com/wadey/gocovmerge@latest
gocovmerge coverage/unit.out coverage/int.out > coverage/merged.out
go tool cover -html=coverage/merged.out -o coverage/merged.html
```
