---
name: homebrew-formula-authoring
description: Create, update, validate, and submit Homebrew formulae (homebrew-core, built from source). Use when the user mentions a Homebrew formula, Homebrew/homebrew-core, adding/updating a formula, brew create, building from source, a build system in a brew context (cargo/rust, go, cmake, meson, autotools/configure, make, python virtualenv, node/npm, ruby gem), resource blocks, depends_on/keg_only/uses_from_macos, the mandatory test do block, bottles, livecheck, brew bump-formula-pr, or when asked to run brew audit --new / brew test / brew style for a formula. For macOS GUI apps and prebuilt binaries use the homebrew-cask-authoring skill instead.
---

# Homebrew Formula Authoring

Author and maintain Homebrew **formulae** (open-source software built from source for `homebrew/core`) with correct stanzas, a meaningful test, audit/style compliance, and local build testing.

**Formula vs Cask — route first.** Formulae are **open-source software built from source** (CLI tools and libraries), cross-platform (macOS + Linux). Casks are **prebuilt macOS GUI binaries**. If the software is a closed-source/binary `.app`, it belongs in a cask — use `homebrew-cask-authoring`. If it is open-source and builds from source (or ships cross-platform bytecode like Java/Mono), it's a formula.

## Operating rules

- Prefer the official Homebrew docs (Formula Cookbook, Acceptable Formulae) when uncertain. Don't author from memory — the DSL and policy change.
- Keep formulae minimal: only stanzas required for a correct build, runtime, and test.
- **Never hand-write a `bottle do` block for a homebrew-core formula.** BrewTestBot builds bottles on CI; a maintainer commits the block on merge via `brew pr-pull`. Authors only write `bottle` blocks in their own third-party taps.
- Build from source must be reproducible on the latest 3 macOS versions (Apple Silicon + Intel) **and** x86_64 Linux, with the latest stable Xcode Clang.
- When testing locally, force Homebrew to read your working copy (`HOMEBREW_NO_INSTALL_FROM_API=1`), not the JSON API.
- Treat local tap overrides and any formula dropped into the core tap as temporary. Restore standard Homebrew state (uninstall, untap, remove stray files) when done unless the user asks to keep it.

## Quick intake (ask these first)

Collect:

- Upstream source URL — a **versioned, stable tarball** (preferred) or a tagged Git ref. No tagged release ⇒ not acceptable.
- Language / build system (Rust/cargo, Go, CMake, Meson, autotools, make, Python, Node, Ruby).
- License — must be a valid SPDX id and **DFSG-acceptable** (open source).
- Runtime vs build-only vs test-only dependencies.
- What the CLI/library actually *does* — needed to write a real `test do` (not `--version`).
- Notability + non-duplicate status (see pre-flight).

If any are unknown, propose a short plan to discover them.

## Pre-flight checks (before writing the formula)

A formula is rejected outright if these fail, regardless of quality:

1. **Open-source + DFSG license.** Core formulae must be open-source with a DFSG license and built from source (or produce cross-platform binaries, e.g. Java/Mono). Binary-only ⇒ send to homebrew-cask. Core formulae must **not** depend on casks or any proprietary software (including auto-installing a cask at runtime).
2. **Stable tagged version.** Must have an upstream-tagged stable release; tarballs preferred over Git checkouts; the tarball filename should contain the version. Beta/unstable/nightly is rejected (only stable `foo@N` versioned formulae are allowed).
3. **Notability.** GitHub repo should have **≥30 forks OR ≥30 watchers OR ≥75 stars**. **Self-submission triples this** (≥90 / ≥90 / ≥225) and it must be *used by someone other than the author* (e.g. a third party opened the PR/issue). Auto-checked by audit.
4. **Not a duplicate.** Search the core tap (`brew formulae | grep -ix <name>`) and [open PRs](https://github.com/Homebrew/homebrew-core/pulls). Duplicates of an existing formula are rejected before review. Duplicates of macOS-provided software are accepted **only** as `keg_only :provided_by_macos`.
5. **Not a fork** — unless the fork is the upstream-designated official successor, or is the replacement used by ≥2 major distros (Debian/Fedora/Arch/Gentoo). Otherwise submit as a vendor-suffixed formula (e.g. `curl-mikemcquaid`).
6. **Builds everywhere with Clang.** Latest 3 macOS (arm + Intel) + x86_64 Linux. Failing a platform without a justified `on_*` disable ⇒ rejected. Not building with Clang reads as "not ported to macOS".
7. **No `.app`/GUI-by-default, no X11/XQuartz, no self-updating, no heavy manual pre/post-install steps.** Self-update must be disabled (it conflicts with `brew upgrade`).

New formulae are held to a *higher* standard than existing ones, and acceptance is partly discretionary — even a clean PR can be declined or sit (maintainers are volunteers). If acceptance is doubtful, a personal tap is a first-class home.

## Workflow: create or update a formula

### 1) Naming

- Filename is all-lowercase: `Formula/<first-char>/<name>.rb` (e.g. `Formula/c/choose.rb`).
- Class name is strict CamelCase of the filename: `foo-bar.rb` → `FooBar`, `foobar.rb` → `Foobar`, `sdl_mixer.rb` → `SdlMixer`. Renaming the class requires renaming the file.
- Match how upstream brands itself (`pkgconf` not `pkgconfig`; `sdl_mixer` not `sdl-mixer`).
- Versioned variants are `foo@1.2` (and usually `keg_only :versioned_formula`).

### 2) Scaffold with `brew create`

```bash
brew create --rust <url>          # also: --go --cmake --meson --autotools --node --python --ruby --cabal --crystal --perl --zig
```

`brew create` downloads the tarball, computes the `sha256`, guesses name/version, writes a stub matching the chosen build system, and opens it in `$EDITOR`. Useful flags: `--set-name`, `--set-version`, `--tap <user>/<tap>`, `--HEAD` (URL is a repo), `--no-fetch`.

**The scaffold leaves predictable traps — fix them (verified against `brew audit --new`):**

- Strip the generated comment block and the placeholder `system "false"` test.
- **Don't keep an explicit `version` line if it's derivable from the URL** — audit flags `` `version X` is redundant with version scanned from URL ``. (Passing `--set-version` plants this.)
- **Fix a deprecated SPDX license.** `brew create` may write `license "GPL-3.0"`; audit rejects it — use `-only` or `-or-later` (e.g. `GPL-3.0-or-later`) for GNU licenses. Cross-check the upstream `Cargo.toml`/`LICENSE`.
- **Rewrite the `desc`** (see §4).

### 3) Draft a minimal formula

Canonical skeleton (Rust/cargo example — the verified `choose` formula):

```ruby
class Choose < Formula
  desc "Human-friendly and fast alternative to cut and awk"
  homepage "https://github.com/theryangeary/choose"
  url "https://github.com/theryangeary/choose/archive/refs/tags/v1.3.7.tar.gz"
  sha256 "8f51a315fbbe0688c4a2078ba8bc8446d36943b6cce6ed9bbd6a11f33bd1a134"
  license "GPL-3.0-or-later"

  depends_on "rust" => :build

  def install
    system "cargo", "install", *std_cargo_args
  end

  test do
    assert_equal "b", pipe_output("#{bin}/choose 1", "a b c\n").chomp
    assert_equal "a c", pipe_output("#{bin}/choose -f : 0 2", "a:b:c\n").chomp
  end
end
```

`brew style --fix` enforces stanza order — don't memorise it. Required: `desc`, `homepage`, `url`, `sha256`, `license`, `def install`, `test do`. Per-build-system `install` one-liners (`std_cargo_args`, `std_go_args(output:)`, `std_cmake_args`, `std_meson_args`, `std_configure_args`, …) and the libexec-vendoring patterns are in `references/homebrew-formula-contribution-workflow.md`.

### 4) `desc` and `license` rules

- **`desc`** (verified cops): **< 80 chars**, and **must not start with an article** (`A`/`An`/`The`). Keep it factual, no marketing. (The current auditor does *not* mechanically flag the formula name or words like "command-line" in `desc`, but reviewers may still ask you to drop them — keep it clean.)
- **`license`**: valid SPDX id, DFSG-acceptable. Use `-only`/`-or-later` for GNU licenses; `license :public_domain` for public domain; SPDX expressions (`any_of:`, `all_of:`) for multi-license.

### 5) Dependencies

- `depends_on "foo"` — runtime dep. `=> :build` build-only (skipped when pouring a bottle), `=> :test` test-only, `=> [:build, :test]` both.
- `$(brew --prefix)/bin` is **not** on `PATH` at build time — every build tool must be declared (`go`/`rust`/`cmake`/`meson`/`pkgconf` as `:build`).
- `uses_from_macos "foo"` — provided by macOS, but needed as a formula on Linux (acts like `depends_on` on Linux only).
- `keg_only :provided_by_macos` (duplicates of system packages) / `keg_only :versioned_formula` (versioned) / `keg_only "reason"` (conflict). Keg-only ⇒ not symlinked into the prefix; still added to `-I`/`-L` for dependents.
- **`:optional` and `:recommended` are banned in homebrew-core** (options aren't CI-tested). Likewise no `option`/`with-`/`without-` build switches.
- Prefer Homebrew's libs: `openssl`/`libressl` (not system), `open-mpi` (not mpich), `openblas` + `-DBLA_VENDOR=OpenBLAS` (not Apple Accelerate), `gcc` for Fortran.

### 6) Resources (vendored deps)

- Use `resource` blocks for language deps Homebrew doesn't package; each pins `url` + `sha256`; install them inside `def install`.
- **Python**: `include Language::Python::Virtualenv`, `depends_on "python@3.x"`, and `def install; virtualenv_install_with_resources; end` — this builds a virtualenv in `libexec` (PEP 668) and installs every `resource`. Declare all transitive deps as `resource` blocks; `brew update-python-resources <formula>` generates them (`--print-only` to preview).
- cargo/gem/pip **may** download *versioned, checksummed* libraries at build time — don't reproduce a language package manager as resources. **Unversioned/unchecksummed** downloads are rejected.

### 7) The test (`test do`) — mandatory, and write a *real* one

- The test runs under `brew test` and BrewTestBot in a temp `testpath` (HOME is set there, dir deleted after).
- **Write a functional test**: process input and assert on output, or compile+link a small program against a shipped library. Helpers: `shell_output`, `pipe_output(cmd, input)`, `assert_equal`, `assert_match`, `assert_path_exists`, `test_fixtures("x")`, a `resource` inside `test do` for fixtures. To capture stderr, redirect it with `2>&1`; `shell_output`'s second arg asserts the exit status (e.g. `shell_output("#{bin}/prog 2>&1", 2)` expects exit code 2).
- **Verified nuance:** `brew audit --new` does **not** mechanically reject a `--version`/`--help`-only test — but the Cookbook calls it inadequate and **maintainers will push back**. Write the real test regardless. "A bad test is better than no test", but aim higher than version/help.

### 8) Bottles & livecheck

- **Bottles**: omit entirely for a new core formula — CI builds them; a maintainer adds the `bottle do` block on merge.
- **livecheck**: run `brew livecheck <formula>` first. GitHub `archive/refs/tags/...tar.gz` URLs auto-resolve via the **Git strategy** with no block needed (verified). Add `livecheck do … url … regex(…) end` only when auto-detection fails; `--debug` shows which strategy matched. `no_autobump! because: :reason` opts out of automated bumps.

### 9) Validate and test locally

Run, in order (silent audit/style output = pass):

```bash
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --build-from-source --verbose --debug <formula>
brew test <formula>
brew style --fix <formula>
HOMEBREW_NO_INSTALL_FROM_API=1 brew audit --new --formula <formula>   # --new implies --strict --online
brew livecheck <formula>
```

Notes:

- `--debug` drops to an interactive shell if the build fails — invaluable for diagnosing.
- `HOMEBREW_NO_INSTALL_FROM_API=1` forces your local tap/formula instead of the JSON API (default since Homebrew 4.x).
- Install/test by **formula name**, not file path.
- `brew audit` prints nothing on success — empty output is a pass, not a no-op.

### 10) Local development vehicle

Dogfood without gambling on acceptance — a **personal tap** runs the entire lifecycle:

```bash
brew tap-new <user>/<tap>
# write Formula/<name>.rb in the tap
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --build-from-source <user>/<tap>/<name>
brew test … ; brew style … ; brew audit --new --formula … ; brew livecheck …
```

For the genuine homebrew-core gate, place the file at `Formula/<first-char>/<name>.rb` in the core tap (or your fork of `Homebrew/homebrew-core`) and run `brew audit --new --formula <name>`. Clean up afterwards (`brew uninstall`, `brew untap`, remove any stray core-tap file). Full setup/teardown in the reference.

### 11) PR hygiene

- One formula per commit; squash. Target the **`main`** branch of `Homebrew/homebrew-core`.
- New formula: fork → branch → `brew create` → edit → validate → commit → PR. **No bottle block.**
- Update: `brew bump-formula-pr --url=… --sha256=…` (or `--version`/`--tag`+`--revision`) does the fork/commit/push/PR and runs audit; `--dry-run`, `--write-only`.
- Commit summary (first line ≤50 chars): `name 1.2.3 (new formula)` · `name 1.2.3` · `name: fix …`. `Closes #NNNN` to reference an issue.

### 12) AI disclosure (mandatory)

Homebrew requires it: **disclose in the issue or PR that you used an AI/LLM and which tool/model**, and confirm you reviewed all generated content before asking anyone to review it. Split it usefully — what the agent ran (the `brew` commands) vs what the human verified (the build, the functional test behaviour).

## Recent changes worth knowing (2025–2026)

- **Bottle attestations** (Sigstore, beta): opt-in via `HOMEBREW_VERIFY_ATTESTATIONS` (needs the `gh` CLI). "failed to verify attestation" errors usually mean an outdated `gh` — `brew upgrade gh` or set `HOMEBREW_NO_VERIFY_ATTESTATIONS=1`.
- **Versioned formulae** (`foo@N`) are now accepted in core (meeting the Versions rules).
- **Duplicates of macOS system packages** are now accepted as `keg_only :provided_by_macos`.
- **Options removed from core** — `:optional`/`:recommended` and `with-`/`without-` are not accepted.
- **Python** apps must install into a `libexec` virtualenv (PEP 668).
- BrewTestBot auto-opens version-bump PRs on a schedule, so routine bumps are increasingly automated.

## Reference

Full end-to-end workflow, the per-build-system install patterns, the verified `choose` worked example (command transcript), acceptance/rejection detail, resources/keg-only/test-design depth, and troubleshooting:

- `references/homebrew-formula-contribution-workflow.md`
