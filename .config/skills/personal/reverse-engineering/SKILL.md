---
name: reverse-engineering
description: Static-first reverse engineering and binary decompilation workflow. Use when the user asks to inspect, decompile, reverse engineer, triage, recover symbols/types/strings, identify endpoints/models/dependencies, explain executable behaviour, or analyse a stripped/packed/obfuscated Mach-O, ELF, PE, WASM, firmware blob, CLI, app bundle, or unknown binary. Use especially when they say not to run it, mention Ghidra, IDA, Binary Ninja, radare2, lldb, strings, xrefs, symbols, Go/Golang, Rust, .NET, Java, Electron, native code, malware triage, or binary internals.
---

# Reverse Engineering

Use this skill for static-first binary analysis. Start with format/runtime identification, then switch into the relevant language/runtime reference. The only detailed reference currently bundled is Go; add more references as workflows are tested.

## Default posture

- Treat "do not run this binary" as a hard constraint.
- Default to static inspection even when the user does not say it explicitly.
- Do not modify the target binary. Write extracted artefacts to a separate workspace under `/tmp` unless the user asks for a specific location.
- If a tool is missing, discuss adding it through Nix or mise before installing anything ad hoc.
- Avoid printing credential-like values verbatim. Record that they exist and where they were found; show only enough prefix/context to identify the finding.

## Workflow

1. Create a workspace:

   ```bash
   mkdir -p /tmp/re-<target-name>
   ```

2. Run baseline static triage:

   ```bash
   file <binary>
   shasum -a 256 <binary>  # macOS
   strings -a <binary> > strings.txt
   ```

3. Identify the likely runtime/language:

   - Go: `go version -m` works, `.gopclntab` / `__gopclntab` exists, or strings mention Go runtime paths such as `runtime.main`.
   - Rust: symbols or strings mention `rustc`, `panic_unwind`, `core::`, `alloc::`, or cargo metadata.
   - .NET: PE metadata, CLR headers, `mscoree.dll`, `System.*`, `Microsoft.*`.
   - Java/Kotlin: JAR/APK/classes, `META-INF`, JVM constant pools.
   - Electron/Node: app archives, `app.asar`, V8 snapshots, `node_modules`, Chromium strings.
   - Native C/C++/Obj-C/Swift: no managed runtime, platform ABI symbols, Objective-C/Swift metadata, dynamic library imports.

4. Read the matching reference before deeper analysis. Current reference:

   - [references/go.md](references/go.md) for Go binaries.

5. For Go binaries, the bundled helper can run the static triage ladder:

   ```bash
   python scripts/go_binary_triage.py <binary> --out /tmp/re-<target-name>
   ```

   If `go` is a mise shim without a selected version, pass the Go command explicitly:

   ```bash
   python scripts/go_binary_triage.py <binary> --go-cmd "mise exec go@1.25 -- go" --out /tmp/re-<target-name>
   ```

6. Recover runtime-specific metadata with at least two independent paths when possible. For Go:

   ```bash
   GoReSym -t -d -p -strings <binary> > goresym.json
   redress info <binary> > redress-info.txt
   redress packages <binary> > redress-packages.txt
   redress source <binary> > redress-source.txt
   ```

   Tool failure is evidence about the tooling, not proof the binary lacks metadata. Record the failure and try the next parser.

7. Use strings as a lead generator, not as proof:

   ```bash
   strings -a <binary> > strings.txt
   ```

   For important literals, confirm pointer/length use or code xrefs before claiming a value is used at runtime.

8. For decompilation, import recovered names/types into the best available workbench:

   - Ghidra latest for free decompilation.
   - IDA 9.2+ if available for stronger Go ABI decompilation.
   - Binary Ninja + Go plugins if available for type-heavy workflows.
   - radare2 when a headless annotation pipeline is more useful than a GUI.

## Evidence Levels

Use explicit confidence language:

- **Confirmed**: backed by build info, recovered function/package metadata, disassembly/xref, or data-flow from reachable code.
- **Likely**: multiple independent static signals align, but exact control flow is not fully proven.
- **Present**: a string, package, symbol, or type exists in the binary, but usage is unproven.
- **Unclear**: tool output conflicts or version/obfuscation limits prevent a stronger claim.

## Report Shape

Keep reports compact and evidence-backed:

```markdown
## Target
- Path:
- Format / arch:
- Runtime / version:
- Hash:
- Execution constraint:

## Static Findings
- Build info:
- Packages / dependencies:
- Recovered user packages:
- Notable endpoints / model routes / config keys:

## Behavioural Claims
| Claim | Evidence | Confidence |
|---|---|---|

## Tool Notes
- Succeeded:
- Failed / limitations:
- Useful next tools:
```

## Tooling Discussion

If the useful tools are missing, propose a small install set rather than a broad RE toolbox:

- **Core CLI**: Go toolchain, GoReSym, Redress/GoRE, `jq`, `ripgrep`.
- **Binary format tools**: `binutils` or LLVM tools on Linux; `otool`/`lldb` already exist on macOS.
- **Workbench**: Ghidra first if a free GUI decompiler is needed; IDA/Binary Ninja only if already available or explicitly desired.
- **Obfuscation extras**: GoStringUngarbler only when garble `-literals` evidence exists.

For dotfiles, discuss whether each belongs in Nix or mise before editing config.
