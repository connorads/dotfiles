# Coverage-Guided Fuzzing: Using Coverage as a Search Signal

Fuzzing is the generative cousin of property-based testing: it feeds a function pseudo-random inputs and watches for crashes, panics, hangs, sanitiser violations, or broken invariants. **Coverage-guided** fuzzers (libFuzzer, AFL++, Go's native engine) close the loop — they instrument the binary and **keep an input only if it reaches new code**, mutating the corpus toward unexplored branches. This is coverage used as a *search heuristic*, which is why fuzzing routinely finds defects that static line/branch coverage never reveals.

Where PBT checks named invariants on structured inputs, fuzzing is best at the *"never crashes / never violates this one assert"* property over byte-level or adversarial inputs — parsers, deserialisers, decoders, protocol handlers, anything that ingests untrusted data.

## Per-ecosystem tooling

| Ecosystem | Tool | Notes |
|-----------|------|-------|
| **Go** | native `go test -fuzz` (stdlib, since Go 1.18) | `FuzzXxx(f *testing.F)`; seed corpus in `testdata/fuzz/`. Runs existing package tests **first**, then runs seeds like unit tests, so it won't re-report what unit tests already catch. |
| **Rust** | [cargo-fuzz](https://rust-fuzz.github.io/book/) | Orchestrates coverage-guided **libFuzzer** via `libfuzzer-sys`; `fuzz_target!` macro. (`afl.rs` is the AFL++ alternative.) |
| **Python** | [Atheris](https://github.com/google/atheris) | libFuzzer-based; coverage-guided; integrates with sanitisers. |
| **JVM** | [Jazzer](https://github.com/CodeIntelligenceTesting/jazzer) | libFuzzer-based for Java/Kotlin. |
| **TypeScript / JS** | [jsfuzz](https://github.com/fuzzitdev/jsfuzz); also fast-check *is* fuzzing | Property-based testing and fuzzing are the same technique at different altitudes ([nelhage](https://blog.nelhage.com/post/property-testing-is-fuzzing/)) — for most JS code, a fast-check property is the practical "fuzzer". |
| **Cross-ecosystem, continuous** | [OSS-Fuzz](https://github.com/google/oss-fuzz) | Free continuous fuzzing for C/C++, Rust, Go, Python, JVM, JS, Lua — libFuzzer + AFL++ + Honggfuzz + sanitisers. **13,000+ vulnerabilities and 50,000+ bugs across 1,000 projects** as of May 2025. |

## CI enforcement: time-box, don't open-end

Fuzzing has no natural end — it runs until it finds a bug or you stop it. The CI pattern is a **time-boxed smoke test** plus **seed-corpus regression gating**, *not* an open-ended run on every PR.

1. **Smoke test in PR CI.** Build the fuzz targets and run each for a short fixed budget. The official Rust example sets `FUZZ_TIME: 300` (5 minutes). This catches regressions cheaply and proves the targets still build/run.
2. **Gate on the seed corpus as regression tests.** Every crash a fuzzer finds → minimise it → commit the input to the corpus. Go runs `testdata/fuzz/` seeds as ordinary unit tests, so past crashes are checked deterministically on every `go test`. Do the same with libFuzzer corpus files.
3. **Continuous fuzzing for high-value targets.** For libraries that parse untrusted input, enrol in OSS-Fuzz (or run a long-budget scheduled job) rather than relying on the PR smoke test.

```yaml
# Rust — time-boxed fuzz smoke test in CI
- run: cargo install cargo-fuzz
- run: cargo fuzz run my_target -- -max_total_time=300   # 5 min, then stop
```

```go
// Go — a regression seed corpus runs on every `go test`, no fuzzing needed
func FuzzParse(f *testing.F) {
    f.Add([]byte("valid"))          // seed
    f.Fuzz(func(t *testing.T, b []byte) {
        _ = Parse(b)                // property: never panics
    })
}
```

## How it complements coverage and the other techniques

- **vs line/branch coverage:** coverage tells you a line ran; fuzzing *drives* execution into the lines and value-combinations you'd never enumerate, and reports the ones that crash.
- **vs PBT:** same engine, different ergonomics — PBT for named invariants on typed inputs; fuzzing for crash/assert properties on byte/adversarial inputs. Many codebases want both.
- **vs mutation testing:** orthogonal. Mutation testing asks "are my assertions strong?"; fuzzing asks "are there inputs I never imagined?".

## Pitfalls

| Pitfall | Mitigation |
|---------|------------|
| No oracle → finds only crashes | Add asserts/invariants inside the target (round-trip, differential vs a reference) so non-crashing bugs surface |
| Open-ended runs blow CI budgets | Time-box (`-max_total_time`/`FUZZ_TIME`); long runs go in scheduled/continuous jobs |
| Found crashes get lost | Minimise and commit to the seed corpus as permanent regression tests |
| Flaky/nondeterministic targets | Fuzz pure logic; isolate or seed nondeterminism |
| Treating "fuzzed for 5 min, no crash" as proof | It's a smoke test; depth comes from continuous fuzzing + a growing corpus |
