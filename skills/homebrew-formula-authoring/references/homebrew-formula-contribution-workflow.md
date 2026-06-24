# Homebrew Formula Contribution Workflow

A complete guide for authoring and contributing **formulae** (open-source, built-from-source software) to Homebrew Core, covering local testing, validation, and submission.

## Prerequisites

- Homebrew installed (`brew --version`).
- Git configured.
- For a real submission: a fork of `Homebrew/homebrew-core` on GitHub.
- A target that meets [Acceptable Formulae](https://docs.brew.sh/Acceptable-Formulae): open-source, DFSG-licensed, stable tagged release, notable, non-duplicate, builds on macOS (arm+Intel) and Linux x86_64.

## Formula vs Cask — route before you start

| | Formula (`homebrew/core`) | Cask (`homebrew/cask`) |
|---|---|---|
| Software | open-source, **built from source** (CLI/library) | prebuilt **macOS GUI binary** (`.app`/`pkg`) |
| License | DFSG open-source **required** | none required (proprietary OK) |
| Platforms | latest 3 macOS (arm+Intel) **+ Linux x86_64** | latest macOS only |
| Test | **mandatory `test do`** | none |
| Bottles | built by CI, block added on merge | none (nothing compiled) |
| Cleanup stanza | none | `zap` |
| Self-updating apps | must be **disabled** | fine / supported |
| Update tool | `brew bump-formula-pr` | `brew bump-cask-pr` |

Binary-only software, GUI `.app`s, and closed-source tools go to a **cask** — use the `homebrew-cask-authoring` skill.

## Setup: make Homebrew use your working copy

### Option A — personal tap (recommended for dogfooding)

A tap is just a Git repo of formulae. This exercises the **entire** authoring lifecycle with zero acceptance risk.

```bash
brew tap-new <user>/<tap>                       # creates $(brew --repository)/Library/Taps/<user>/homebrew-<tap>
# write the formula at Formula/<name>.rb inside that tap (flat layout is fine in a personal tap)
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --build-from-source <user>/<tap>/<name>
```

Teardown when done:

```bash
brew uninstall <name>
brew untap <user>/<tap>
```

### Option B — genuine core gate (your fork, or the local core tap on a branch)

The core auditor can fire cops a personal tap won't (correct `Formula/<first-char>/` path, duplicate-name detection, core-only rules). To reproduce it:

```bash
CORE=$(brew --repository)/Library/Taps/homebrew/homebrew-core
# place the formula at the canonical path
mkdir -p "$CORE/Formula/<first-char>"
cp <name>.rb "$CORE/Formula/<first-char>/<name>.rb"
HOMEBREW_NO_INSTALL_FROM_API=1 brew audit --new --formula homebrew/core/<name>
brew style homebrew/core/<name>
# restore pristine state
rm "$CORE/Formula/<first-char>/<name>.rb"
git -C "$CORE" status --porcelain   # confirm clean
```

This is faster than cloning a multi-GB fork and runs the identical audit. For a real PR, do the equivalent in your own fork checkout. **Always restore standard Homebrew state afterwards.**

## Canonical formula structure

```ruby
class Name < Formula
  desc "Short factual description"      # < 80 chars, no leading article
  homepage "https://example.com"
  url "https://example.com/name-1.2.3.tar.gz"
  sha256 "..."
  license "SPDX-Id"                     # DFSG; -only/-or-later for GNU

  # depends_on "dep"            # runtime
  # depends_on "tool" => :build # build-only

  def install
    # build-system-specific (see appendix)
  end

  test do
    # functional assertion — NOT just --version
  end
end
```

`brew style --fix` enforces component ordering (RuboCop) — rely on it instead of memorising the order. Optional stanzas, roughly in order: `revision` / `version_scheme` (under the url/sha256/license block), `head`, `no_autobump!`, `livecheck do`, `keg_only`, `depends_on` / `uses_from_macos`, `on_macos`/`on_linux`/`on_arm`/`on_intel` blocks, `conflicts_with`, `resource` blocks, `patch`, `def install`, `def post_install`, `service do`, `def caveats`, `test do`, then `__END__` (embedded `:DATA` patch).

## Build-system appendix (install patterns)

Each `std_*_args` accepts kwargs (e.g. `prefix:`, `install_prefix:`) to retarget into `libexec`. `libexec` is the formula's private dir (not symlinked into the prefix) — vendor language deps and hide internal binaries there, then symlink/wrap the public ones into `bin`.

### Rust / Cargo

```ruby
depends_on "rust" => :build
def install
  system "cargo", "install", *std_cargo_args   # --jobs N --locked --root=#{prefix} --path=.
end
```

`--locked` needs a committed `Cargo.lock` in the tarball.

### Go

```ruby
depends_on "go" => :build
def install
  system "go", "build", *std_go_args(output: bin/"name")   # -trimpath -o=#{output}
end
```

Pass `output:` so the binary lands in `bin`. `std_go_args` also takes `ldflags:`/`gcflags:`/`tags:`.

### CMake

```ruby
depends_on "cmake" => :build
def install
  system "cmake", "-S", ".", "-B", "build", *std_cmake_args
  system "cmake", "--build", "build"
  system "cmake", "--install", "build"
end
```

`std_cmake_args` sets `-DCMAKE_INSTALL_PREFIX`, `-DCMAKE_BUILD_TYPE=Release`, `-DBUILD_TESTING=OFF`, etc. Delete the commented cmake lines `brew create` generates if upstream actually uses `./configure`.

### Meson

```ruby
depends_on "meson" => :build
depends_on "ninja" => :build
def install
  system "meson", "setup", "build", *std_meson_args   # --prefix --libdir --buildtype=release --wrap-mode=nofallback
  system "meson", "compile", "-C", "build"
  system "meson", "install", "-C", "build"
end
```

`--wrap-mode=nofallback` stops Meson silently downloading wrap subprojects instead of declared deps.

### Autotools / GNU configure

```ruby
def install
  system "./configure", *std_configure_args   # --disable-debug --disable-dependency-tracking --prefix=#{prefix} --libdir=#{libdir}
  system "make", "install"
end
```

Some `configure` scripts reject `--disable-debug`/`--disable-dependency-tracking` — check the top of the configure output and drop the offending flag. Add `--mandir=#{man}` if it installs to `man/`; `--sysconfdir=#{etc}` for persistent config.

### Make-only

```ruby
def install
  system "make", "CC=#{ENV.cc}", "PREFIX=#{prefix}"
  system "make", "install", "PREFIX=#{prefix}"
end
```

Pass Makefile vars as separate `system` args (not `change_make_var!`). If parallel build breaks, `ENV.deparallelize` and split compile/install.

### Python (virtualenv + resources)

- `include Language::Python::Virtualenv` and call `virtualenv_install_with_resources` — it builds a virtualenv in `libexec` (PEP 668) and installs every `resource`. `depends_on "python@3.y"`.
- All transitive deps as explicit `resource` blocks (pin `url`+`sha256`).
- `brew update-python-resources <formula>` generates the resource stanzas; `--print-only` previews.

```ruby
include Language::Python::Virtualenv

depends_on "python@3.13"

resource "dep" do
  url "https://files.pythonhosted.org/packages/.../dep-1.0.tar.gz"
  sha256 "..."
end

def install
  virtualenv_install_with_resources
end
```

### Node / npm

```ruby
depends_on "node"
def install
  system "npm", "install", *std_npm_args   # installs --global into libexec
  bin.install_symlink Dir[libexec/"bin/*"]
end
```

### Ruby gem (bundler)

```ruby
def install
  ENV["GEM_HOME"] = libexec
  system "bundle", "config", "set", "--local", "without", "development"
  system "bundle", "install"
  system "gem", "build", "name.gemspec"
  system "gem", "install", "--ignore-dependencies", "name-#{version}.gem"
  bin.install libexec/"bin/name"
  bin.env_script_all_files(libexec/"bin", GEM_HOME: ENV.fetch("GEM_HOME", nil))
end
```

Prefer bundler with the upstream `Gemfile.lock`; file an issue upstream if it's missing.

### Useful helpers

- Dirs: `prefix bin lib libexec include share pkgshare etc var man1..8 sbin`; completion dirs `bash_completion zsh_completion fish_completion`; `buildpath` (build cwd), `testpath` (test cwd); `opt_*` stable variants.
- Relocatable symlinks: `bin.install_symlink libexec/"name"` (relative) over `ln_s`.
- Wrappers: `write_exec_script`, `write_env_script`, `env_script_all_files`.
- `inreplace` (not `patch`) for never-upstreamable build edits.
- Messaging: `ohai` (info), `opoo` (warning), `odie` (error + exit).
- Platform branching inside `def install`/`test do`: use `OS.mac?`/`OS.linux?`/`Hardware::CPU.arm?` — **not** `on_*` blocks (those are for deps/resources/patches only, never inside install/test).

## Worked example: `choose` (verified end-to-end)

`theryangeary/choose` — a Rust `cut`/`awk` alternative, GPL-3.0-or-later, ~2.2k★, not yet in core: a clean candidate (single crate, pure-Rust deps, deterministic output for a real test).

### Scaffold

```bash
brew create --rust --set-name choose \
  https://github.com/theryangeary/choose/archive/refs/tags/v1.3.7.tar.gz
# downloads, computes sha256 (8f51a315...), writes Formula/choose.rb, opens editor
```

The scaffold's traps (all confirmed by `brew audit --new`): a `desc` starting with "A", a redundant `version` line (when `--set-version` is passed), `license "GPL-3.0"` (deprecated SPDX), a placeholder `system "false"` test, and comment cruft.

### Final formula

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

### Validation transcript (all green)

```bash
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --build-from-source --verbose connorads/test/choose
#   ... Compiling regex/structopt/... ; choose v1.3.7 ; Finished release in 10s ; 2.7MB
brew test connorads/test/choose                       # runs both assertions, passes
brew style connorads/test/choose                      # 1 file inspected, no offenses detected
HOMEBREW_NO_INSTALL_FROM_API=1 brew audit --strict --online connorads/test/choose   # silent = pass
HOMEBREW_NO_INSTALL_FROM_API=1 brew audit --new --formula connorads/test/choose     # exit 0 = pass
brew livecheck connorads/test/choose                  # choose: 1.3.7 ==> 1.3.7 (Git strategy, no block needed)
# core gate:
HOMEBREW_NO_INSTALL_FROM_API=1 brew audit --new --formula homebrew/core/choose      # exit 0 = pass
```

### What the broken-variant audit taught us (verified cops)

Auditing a deliberately bad version produced exactly these `brew audit --new --strict --online` problems:

- `Stable: version 1.3.7 is redundant with version scanned from URL`
- `Description is too long. It should be less than 80 characters.`
- `Description shouldn't start with an article.` (also a RuboCop autocorrect)
- `Formula choose contains deprecated SPDX licenses: ["GPL-3.0"]. You may need to add -only or -or-later ...`

And, importantly, **what did NOT fire**: a `system bin/"choose", "--version"` test was *not* flagged (audit doesn't mechanically reject weak tests — maintainers do), and `desc` containing "command-line"/the formula name was *not* flagged. Write the real test and a clean desc anyway.

## Acceptable Formulae (detail)

**Accepted**: open-source + DFSG license, built from source (or cross-platform bytecode); stable tagged release (tarball preferred); notable (≥30 forks / ≥30 watchers / ≥75★; 3× for self-submission + used by a third party); has a homepage; CLI/library by default (GUI only if widely useful); ships shared libraries (may also ship static); builds with latest stable Clang on the latest 3 macOS + x86_64 Linux. Versioned formulae (`foo@N`) and duplicates of macOS packages (`keg_only :provided_by_macos`) are now allowed.

**Rejected**: binary-only (→ cask); no stable tagged version; beta/unstable; needs patching to work / has unpatched CVEs; not notable; not used by anyone but the author / no homepage; forks (unless official successor or replacement in ≥2 major distros); builds an `.app` or X11/XQuartz GUI; doesn't build with Clang; self-updating (must disable); heavy manual pre/post-install; static-only libraries (especially for depended-on formulae); depends on a cask/proprietary software. Acceptance is partly **discretionary** and new formulae face a higher bar.

### keg_only

- `keg_only :provided_by_macos` — duplicates of macOS-shipped software (kept unlinked so it doesn't shadow the system copy).
- `keg_only :versioned_formula` — a `foo@N` that can't be linked alongside its unversioned counterpart. Must not `post_install` anything into the prefix that duplicates the main formula; must stay ABI-stable for the version's life.
- `keg_only "reason"` — conflicts with another formula (last resort; prefer removing the offending file).

## Test design patterns

- **Deterministic CLI**: feed input, assert output. `assert_equal "b", pipe_output("#{bin}/foo 1", "a b c\n").chomp`.
- **Library**: write a small source file, compile+link against the lib, run it, assert. (`tinyxml2`, `cmake` formulae are exemplars.)
- **GUI app**: test a CLI-only function (format conversion, config read).
- **Needs credentials/VM**: connect with invalid/no credentials and assert it fails as expected (preferred over mocking).
- Fixtures: `test_fixtures("test.svg")`, or a `resource "testdata"` inside `test do` staged with `resource("testdata").stage`.
- `test do` runs in a temp `testpath` with `HOME` set there; the dir is deleted afterwards.

## Validation command reference

```bash
HOMEBREW_NO_INSTALL_FROM_API=1 brew install --build-from-source --verbose --debug <f>  # --debug = shell on failure
brew test <f>
brew style <f> ; brew style --fix <f>                # RuboCop; --only-cops= to target
HOMEBREW_NO_INSTALL_FROM_API=1 brew audit --new --formula <f>   # --new implies --strict --online; silent = pass
brew livecheck <f> ; brew livecheck --debug <f>      # which strategy matched
brew update-python-resources <f> [--print-only]      # regenerate PyPI resources
brew bump-formula-pr --dry-run --url=... --sha256=... <f>
```

## Submitting

### New formula (manual)

```bash
# fork Homebrew/homebrew-core, then in your fork checkout on a branch:
brew create --<buildsystem> <url>      # edit: homepage, license, deps, install, test
# run the full validation loop above (NO bottle block — CI adds it)
git add Formula/<first-char>/<name>.rb
git commit -m "<name> 1.2.3 (new formula)"     # first line <= 50 chars
git push origin <branch>
gh pr create --base main --repo Homebrew/homebrew-core --title "<name> 1.2.3 (new formula)" --body-file - <<'EOF'
<one-sentence description>. Built and tested locally on macOS.

<AI disclosure: tool/model used; what the agent ran; what was verified manually.>
EOF
```

### Version update

```bash
brew bump-formula-pr --url=<new-url> --sha256=<new-sha> <name>
# or --version=<v> / --tag=<t> --revision=<sha> ; --dry-run, --write-only, --no-browse
```

`brew bump` lists outdated formulae + existing bump PRs.

### After the PR

- **BrewTestBot** builds + tests on macOS arm64, macOS x86_64, and Linux x86_64; PR status shows Queued/Failed/Passed with a Details link.
- On green CI + maintainer approval, a maintainer runs `brew pr-pull` to fetch CI bottles, write the `bottle do` block, and publish to GitHub Packages. **You never edit `bottle do`.**
- Respond to review on the same branch; do not squash away history after opening (maintainers squash on merge).

## Troubleshooting

- **Build fails** → re-run with `--debug` to drop into a shell at the failure; check declared build deps (`$(brew --prefix)/bin` isn't on PATH at build).
- **`cargo --locked` errors** → the tarball lacks an up-to-date `Cargo.lock`; report upstream or adjust.
- **"failed to verify attestation" / "invalid build provenance"** → outdated `gh`; `brew upgrade gh` or `HOMEBREW_NO_VERIFY_ATTESTATIONS=1`.
- **Formula not found / API used instead of your file** → prefix `HOMEBREW_NO_INSTALL_FROM_API=1`.
- **livecheck finds nothing** → add a `livecheck do … regex(…) end`; use `--debug` to see the strategy.
- **Audit silent** → that's a pass. Audit prints only on problems.
- **`desc` cops** → < 80 chars, no leading article.
- **Deprecated SPDX** → add `-only`/`-or-later` for GNU licenses.

## Key documentation

- Formula Cookbook: <https://docs.brew.sh/Formula-Cookbook>
- Acceptable Formulae: <https://docs.brew.sh/Acceptable-Formulae>
- Versions: <https://docs.brew.sh/Versions>
- Python for Formula Authors: <https://docs.brew.sh/Python-for-Formula-Authors>
- Node for Formula Authors: <https://docs.brew.sh/Node-for-Formula-Authors>
- How To Open a Homebrew PR: <https://docs.brew.sh/How-To-Open-a-Homebrew-Pull-Request>
- Formula API (rubydoc): <https://docs.brew.sh/rubydoc/Formula>
