# Go Binary Reference

This reference is for static reverse engineering of binaries produced by the standard Go compiler. TinyGo, gccgo, heavily packed binaries, and custom linkers need separate handling.

## Tool Ladder

1. **Baseline triage**

   ```bash
   file <binary>
   shasum -a 256 <binary>             # macOS
   sha256sum <binary>                 # Linux
   go version -m -json <binary>
   strings -a <binary> > strings.txt
   ```

2. **GoReSym first**

   ```bash
   GoReSym -t -d -p -strings <binary> > goresym.json
   ```

   GoReSym extracts OS/arch/compiler version, function starts/ends/names/sources, file/line metadata, packages, types, and embedded Go strings. It is based on Go runtime/compiler code and handles stripped binaries, UPX-unpacked oddities, split data ranges, and moduledata discovery.

   Observed behaviour: GoReSym handled a local stripped Go 1.25.12 Mach-O sample, but can still fail on larger modern Go binaries with errors such as `no valid pclntab found`. Treat this as a parser limitation and try Redress/GoRE next.

3. **Redress / GoRE second**

   ```bash
   redress info <binary>
   redress packages <binary>
   redress source <binary>
   redress moduledata <binary>
   redress types all <binary>
   ```

   Redress is useful for package classification, source projection, method/function ranges, and radare2 integration. Locally, Redress v1.2.77 recovered packages and source projection on a modern stripped Go binary where GoReSym failed.

   Gotcha: the `types` subcommand can fail even when `info`, `packages`, and `source` work. In one Go 1.25.12 sample it reported `no goversion found`, while forcing versions through `--version` was rejected by the bundled GoRE version table. Do not stop there; use GoReSym type output or a small GoRE script.

4. **Workbench**

   - **Ghidra latest**: best free decompiler path. Use recovered names/types from GoReSym or Redress to improve output.
   - **IDA 9.2+**: strongest commercial path for Go ABI readability, especially multi-return calls and register/stack mixtures.
   - **Binary Ninja**: good optional path when Go type plugins or GoReSym import are available.
   - **radare2**: useful for headless annotation through GoReSym flags or Redress r2pipe.

5. **Obfuscation-specific**

   - Garble can hide names, positions, module/build/debug info, and optionally string literals.
   - Garble `-literals` replaces string literals with runtime expressions. GoStringUngarbler can recover some PE/ELF garble-literals samples, but support is version/arch-limited.

## Go Metadata Anchors

### Build Info

Use:

```bash
go version -m -json <binary>
```

If `go` is managed by mise and the shim has no selected version, either run the whole command under mise or pass an explicit Go command to the bundled helper:

```bash
python scripts/go_binary_triage.py <binary> --go-cmd "mise exec go@1.25 -- go"
```

Build info can reveal:

- Go toolchain version.
- Main module path and version.
- Dependency modules and replacement paths.
- Build settings such as `GOOS`, `GOARCH`, `CGO_ENABLED`, `-trimpath`, `vcs.revision`, and `vcs.modified`.

Build info is high-confidence when present. Absence is not proof the binary is not Go; obfuscation and unusual build/link paths can remove or damage it.

Sources: `debug/buildinfo`, `runtime/debug.BuildInfo`, Go 1.24 release notes for richer VCS build info.

### pclntab

`pclntab` maps program counters to Go function names, source files, and line information. It remains useful in many stripped binaries because the runtime needs it for stack traces and symbolisation.

Version magic:

| Go version | Magic |
|---|---|
| 1.2-1.15 | `0xfffffffb` |
| 1.16-1.17 | `0xfffffffa` |
| 1.18-1.19 | `0xfffffff0` |
| 1.20+ | `0xfffffff1` |

Use section names where present (`.gopclntab`, `__gopclntab`), then magic-byte scanning when sections are renamed or packed.

### moduledata

`moduledata` ties together:

- `pcHeader`
- function name/file/pcline tables
- `ftab`
- text/data ranges
- `types` / `etypes`
- `typelinks`
- `itablinks`
- init tasks

Its layout changes with Go versions. Prefer tool parsers over hand offsets unless you are writing a focused extractor.

### Function Boundaries

Recovered function starts are usually strong evidence. Function ends are often inferred from the next function entry or table data, so treat exact end addresses as tool-derived boundaries rather than source-level guarantees.

With Redress/GoRE, function offsets may need normalisation. In local tests on Go 1.25 arm64, low-bit-clearing was needed before aligning Redress function offsets with disassembly addresses.

Small helpers may disappear as standalone functions because the Go compiler inlines them. In a local Go 1.25.12 sample, `selectRoute` and `buildConfig` were present in source but absent from `go tool nm` and recovered function lists; their string/data effects were folded into callers. Treat "missing function" as "not recovered as a separate compiled function", not "not present in source".

### Types and Interfaces

`typelinks` points to runtime type descriptors. `itablinks` exposes concrete-interface relationships used by the runtime.

Useful claims:

- Struct/type names and fields can identify domain concepts.
- Method sets can reveal important receiver types.
- Interface tables can show static concrete-interface pairings.

Avoid:

- Assuming all possible interface implementations appear in `itablinks`.
- Assuming type recovery is complete on the newest Go versions.

### Strings

Go strings are pointer + length, not NUL-terminated C strings. Raw `strings` output can merge adjacent literals, runtime text, dependency strings, and unrelated constants into one printable run.

For important literals:

1. Locate exact byte offsets and virtual addresses.
2. Confirm a plausible pointer/length pair.
3. Find code or data xrefs that materialise the pointer and length.
4. Tie the xref to a recovered function/package when possible.

Use cautious phrasing:

- "contains `cosine:gpt-5.4`" from raw strings.
- "references `cosine:gpt-5.4` in package X/function Y" from xrefs.
- "uses `cosine:gpt-5.4` for role Z" only after control/data-flow supports it.

### ABI and Decompiler Readability

Go 1.17 introduced the register-based internal ABI on amd64, with rollout to other architectures afterward. Modern Go decompilation can mix register and stack-passed values, multiple returns, wrappers, inlining, and devirtualisation.

Implications:

- Keep Go version and architecture beside every decompiler observation.
- Be suspicious of undefined temporary variables in weaker decompilers.
- Use recovered source file/function names to orient yourself before reading pseudocode.

## Version Gotchas

- **Go 1.22**: `-s` suppresses symbol tables and implies `-w`; `-s -w=0` can keep DWARF while removing symbols. Some Darwin builds default to PIE.
- **Go 1.23**: iterators, stack slot overlap, PGO changes, and linkname checks can make variable lifetimes and layout less obvious.
- **Go 1.24**: richer VCS build info by default; map internals changed.
- **Go 1.25**: DWARF5 by default and linker `-funcalign`; use current DWARF consumers and avoid brittle function-start signatures.

## Evidence Patterns

### Endpoints / API Hosts

Good evidence chain:

```text
raw string -> exact VA -> pointer/length xref -> recovered package/function -> surrounding call path
```

If only raw strings exist, report presence but do not claim network use.

### Model / Route Names

Go binaries often contain maps or route tables as adjacent strings. A line like:

```text
cosine:gpt-5.5cosine:gpt-5.4cosine:gpt-5.4-mini
```

may be several distinct Go strings packed together. Recover lengths or xrefs before deciding the exact values.

### Dependencies

Build info and recovered package names are strong evidence that code was linked in. They are weaker evidence that a feature is reachable. Dead-code elimination removes much unused code, but stdlib/runtime dependencies can still be broad because of one imported package.

## Useful Sources

- Go build info: <https://pkg.go.dev/debug/buildinfo>
- Go objdump: <https://pkg.go.dev/cmd/objdump>
- Go internal ABI: <https://go.dev/src/cmd/compile/abi-internal>
- GoReSym: <https://github.com/mandiant/GoReSym>
- Mandiant Go internals and symbol recovery: <https://cloud.google.com/blog/topics/threat-intelligence/golang-internals-symbol-recovery/>
- Redress: <https://github.com/goretk/redress>
- GoRE library: <https://pkg.go.dev/github.com/goretk/gore>
- CUJO Ghidra Go notes: <https://cujo.com/blog/reverse-engineering-go-binaries-with-ghidra/>
- Garble: <https://github.com/burrowers/garble>
- GoStringUngarbler: <https://github.com/mandiant/gostringungarbler>
