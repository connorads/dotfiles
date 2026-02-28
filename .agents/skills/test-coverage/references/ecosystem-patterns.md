# Ecosystem-Specific Coverage Patterns

Language-specific tools, configuration examples, and runner syntax. Each ecosystem has its own reference file — load only the one you need.

| Ecosystem | File | Key tools |
|-----------|------|-----------|
| TypeScript / JavaScript | [ecosystems/typescript.md](ecosystems/typescript.md) | Vitest, Jest, Playwright, testing-library, v8, Istanbul |
| Python | [ecosystems/python.md](ecosystems/python.md) | pytest-cov, coverage.py, hypothesis |
| Go | [ecosystems/go.md](ecosystems/go.md) | go test -cover, gotestsum, build tags |
| Rust | [ecosystems/rust.md](ecosystems/rust.md) | cargo-tarpaulin, cargo-llvm-cov, proptest |
| Merging reports | [ecosystems/merging.md](ecosystems/merging.md) | lcov, codecov flags, coveralls, gocovmerge |

## Quick ecosystem detection

| Marker file | Ecosystem |
|-------------|-----------|
| `package.json` | TypeScript / JavaScript |
| `pyproject.toml`, `setup.py`, `setup.cfg` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| `*.csproj`, `*.sln` | C# / .NET |
| `build.gradle`, `pom.xml` | Java / Kotlin |

Detect the marker, then load the corresponding ecosystem reference.
