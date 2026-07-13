# Merging Multi-Tier Coverage

Techniques for combining coverage reports from multiple test tiers into a unified view.

## lcov (cross-language standard)

```bash
# Merge multiple lcov files
lcov \
  -a coverage/unit/lcov.info \
  -a coverage/int/lcov.info \
  -a coverage/components/lcov.info \
  -o coverage/merged.info

# Generate combined HTML report
genhtml coverage/merged.info --output-directory coverage/merged
```

## Codecov (per-tier flags)

Upload each tier separately with flags for independent tracking:

```bash
codecov --flags unit --file coverage/unit/lcov.info
codecov --flags integration --file coverage/int/lcov.info
codecov --flags components --file coverage/components/lcov.info
```

## Coveralls

```bash
# Multiple files in one upload
coveralls-lcov \
  --merge coverage/unit/lcov.info \
  --merge coverage/int/lcov.info \
  coverage/components/lcov.info
```

## Go profile merging

```bash
# gocovmerge for multiple profiles
go install github.com/wadey/gocovmerge@latest
gocovmerge coverage/unit.out coverage/int.out > coverage/merged.out
go tool cover -html=coverage/merged.out -o coverage/merged.html
```
