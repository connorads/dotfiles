---
name: reverse-engineering
description: >-
  Performs static-first reverse engineering and binary decompilation without
  launching the target. Use when the user asks to inspect, decompile, triage,
  recover symbols/types/strings, identify endpoints/models/dependencies, explain
  executable behaviour, or recover implementation patterns from an unknown,
  stripped, packed, or obfuscated binary, CLI, DMG, macOS app bundle, Mach-O,
  ELF, PE, WASM, firmware image, Go binary, or packaged JavaScript/TypeScript
  executable. Also use for Ghidra, IDA, Binary Ninja, radare2, strings, xrefs,
  Swift/Objective-C metadata, Bun compile, Node SEA, pkg/nexe, and Deno compile
  analysis. Not for source-only code review or ordinary archive extraction where
  executable behaviour is irrelevant.
---

# Reverse Engineering

For every claim, ask:

> Which layer produced this evidence, and does it prove presence or execution?

Start with container and runtime identification, then load only the matching
reference.

## Default Posture

- Treat "do not run this binary" as a hard constraint.
- Default to static inspection even when the user does not say so explicitly.
- Never modify the target. Write extracted artefacts to a separate workspace
  under `/tmp` unless the user requests another location.
- Mount a disk image only with user permission and the safety sequence in
  [references/macos-apps.md](references/macos-apps.md).
- Avoid printing credential-like values verbatim. Record their existence and
  location; reveal only enough context to identify the finding.
- For hostile or genuinely unknown malware, use a disposable VM instead of
  asking the host OS to parse or mount it.

## Workflow

1. Establish scope and constraints. Record whether target execution, mounting,
   network access, extraction, or modification is allowed.

2. When the user wants product behaviour or reusable features, research official
   documentation and public artefacts first. Build an expected feature matrix so
   documented behaviour is not misreported as a binary discovery.

   Search for an existing third-party client or SDK for the same target, in any
   language. Someone may already have done this work, and their source names
   endpoints, field semantics, and gotchas directly. Treat it as a hypothesis to
   verify against the binary, never as ground truth: it may be stale, may target
   the other platform's client, and may carry bugs of its own.

3. Create a disposable workspace:

   ```bash
   mktemp -d /tmp/re-<target-name>.XXXXXX
   ```

4. Run baseline static triage against a file:

   ```bash
   file <binary>
   shasum -a 256 <binary>    # macOS
   sha256sum <binary>        # Linux
   strings -a <binary> > /tmp/re-<target-name>/strings.txt
   ```

   Save broad output to files and query it with `rg`; do not flood the
   conversation with raw strings or symbol tables.

5. Identify the container and likely runtime:

   - Go: `go version -m`, `.gopclntab` / `__gopclntab`, or Go runtime paths.
   - Packaged JS CLI: Bun/JSC, Node SEA, `pkg`/`nexe`, Deno, virtual filesystem,
     or embedded runtime markers.
   - Native Apple: Mach-O plus Swift reflection, Objective-C metadata, AppKit,
     SwiftUI, or Apple framework imports.
   - .NET: PE CLR headers, `mscoree.dll`, or managed assembly metadata.
   - Java/Kotlin: JAR/APK/classes, `META-INF`, or JVM constant pools.
   - Rust/C/C++: platform ABI metadata and language/runtime fingerprints without
     a managed payload.

6. Read the matching reference before deeper analysis:

   | Target evidence | Read |
   |---|---|
   | DMG, `.app`, Mach-O, Swift, Objective-C | [references/macos-apps.md](references/macos-apps.md) |
   | Standard Go compiler | [references/go.md](references/go.md) |
   | Bun compile, Node SEA, `pkg`/`nexe`, Deno compile | [references/package-js-cli.md](references/package-js-cli.md) |
   | APK, XAPK, APKS, AAB, DEX, Android, Kotlin | [references/android-apk.md](references/android-apk.md) |

   No runtime-specific reference is bundled yet for .NET, desktop JVM, Rust,
   Electron, Tauri, PE, ELF, WASM, or firmware. Apply the generic workflow, label
   the coverage limit, and add a reference only after a real analysis exposes
   repeatable failures.

7. Use the bundled static helpers when their target matches:

   ```bash
   python3 scripts/macos_app_triage.py <binary-or-app> --out /tmp/re-<target-name>
   python3 scripts/macos_app_triage.py <image.dmg> \
     --allow-mount --out /tmp/re-<target-name>
   python3 scripts/go_binary_triage.py <binary> --out /tmp/re-<target-name>
   ```

   `macos_app_triage.py` does not mount a DMG unless `--allow-mount` is present.
   It never launches the target. `go_binary_triage.py` accepts `--go-cmd` when a
   version manager needs an explicit Go invocation.

8. Recover metadata with at least two independent paths where practical.
   A parser failure — or an empty search result — is evidence about your tool and
   your command, not proof that the thing is absent. A mistyped path, a glob the
   shell ate, or a wrong `--include` is silent in exactly the same way as genuine
   absence, so reproduce a negative a second way before reporting it. Record
   conflicts and try the next native or runtime-aware tool.

9. Use raw strings as leads. For important literals, confirm offsets,
   pointer/length use, xrefs, or reachable code flow before claiming runtime use.
   Search to locate, read to quote: take load-bearing literals — hostnames, keys,
   field names, numeric constants — from the file itself, not from the terminal
   output of a search pipeline.

10. Import recovered names and types into a workbench only after container and
    runtime triage:

    - Ghidra for a free decompiler.
    - IDA or Binary Ninja when already available and materially stronger for the
      target.
    - radare2 for headless annotation and repeatable queries.

## Evidence Levels

- **Observed**: a request you sent and the response you received, recorded
  verbatim. The strongest evidence available for a network API, and the only kind
  that can refute a static reading.
- **Confirmed**: container metadata, build information, recovered
  function/package metadata, disassembly/xref, or reachable data flow.
- **Likely**: multiple independent static signals align, but exact control flow
  is not fully proven.
- **Present**: a string, package, symbol, type, entitlement, framework, or
  resource exists; usage is unproven.
- **Unclear**: tools conflict, metadata is damaged, or packing/obfuscation blocks
  a stronger claim.

Never turn linkage, an entitlement, a raw string, or a valid signature into an
execution claim.

Static reading and live behaviour disagree more often than either seems to
warrant. Where a claim is load-bearing, establish it both ways.

## Probing a Live Service

A network API has a second evidence source the binary cannot provide: the server
itself. Probing is not running the target, and it settles what static analysis
cannot — which inputs are genuinely required, what the real limits are, and
whether something you could not find exists after all.

It is also the only step here that writes to infrastructure you do not own.

- Probe resources you created for the purpose, never someone else's.
- Establish what is reversible **before** the first write. Many services have no
  delete: test data may be permanent, and the volume you generate is the
  operator's cost to carry.
- Stay read-only until you have a throwaway target to write to.
- Keep request rates indistinguishable from ordinary use.
- Do not probe authentication or authorisation boundaries, and do not enumerate
  identifiers to reach other people's data.
- Record every request and response to a file as you go.

Get the user's agreement before the first write to a service you do not operate.

A constant read from the binary is a client default, not a server limit. Page
sizes, batch sizes, timeouts, and retry counts tell you what this client chooses,
not what the server permits. Label them as client behaviour until a probe
establishes the ceiling.

## Report Shape

```markdown
## Target
- Path:
- Container / architecture:
- Runtime / version:
- Hash:
- Execution and mounting constraints:

## External Baseline
- Documented behaviours:
- Expected components:

## Static Findings
- Bundle / build information:
- Dependencies and recovered user code:
- Notable endpoints, routes, models, configuration, or persistence:

## Behavioural Claims
| Claim | Evidence | Confidence |
|---|---|---|

## Tool Notes
- Succeeded:
- Failed / conflicts:
- Coverage limits:
```

## Validation Assets

- Run `bats tests/macos_app_triage.bats` on macOS after changing the macOS
  helper or mount safety behaviour.
- `evals/evals.json` contains human-reviewed regression prompts derived from
  real analysis failures. Run each draft and baseline in fresh sessions.
