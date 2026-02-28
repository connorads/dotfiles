# Rust Coverage Patterns

## cargo-tarpaulin

```bash
# Install
cargo install cargo-tarpaulin

# Run with HTML report
cargo tarpaulin --out html --output-dir coverage/

# Enforce threshold
cargo tarpaulin --fail-under 90

# Exclude specific files
cargo tarpaulin --exclude-files "src/generated/*" --exclude-files "src/migrations/*"
```

## cargo-llvm-cov (higher accuracy)

```bash
# Install
cargo install cargo-llvm-cov

# Run with HTML report
cargo llvm-cov --html --output-dir coverage/

# Enforce threshold
cargo llvm-cov --fail-under-lines 95

# Show uncovered lines
cargo llvm-cov --text
```

## Excluding code from coverage

```rust
// Exclude from tarpaulin
#[cfg(not(tarpaulin_include))]
fn platform_specific_code() {
    // Only runs on specific OS — tested via integration tests on CI matrix
}

// Exclude a single line (tarpaulin)
// tarpaulin: skip next line — defensive unwrap, value always Some after init
let value = optional.unwrap();
```

## Property testing with proptest

```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn slugify_never_panics(s in "\\PC{1,100}") {
        let _ = slugify(&s);  // should never panic
    }

    #[test]
    fn slugify_output_is_lowercase(s in "[a-zA-Z ]{1,50}") {
        let result = slugify(&s);
        assert_eq!(result, result.to_lowercase());
    }
}
```

## Integration tests (separate binary)

```rust
// tests/integration/db_test.rs
use my_crate::db::Repository;

#[tokio::test]
async fn test_create_and_fetch_user() {
    let repo = Repository::new_test().await;
    let user = repo.create_user("test@example.com").await.unwrap();
    let fetched = repo.get_user(user.id).await.unwrap();
    assert_eq!(fetched.email, "test@example.com");
}
```
