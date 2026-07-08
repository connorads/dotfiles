# Packaged JavaScript CLI Reference

Use this reference for static-first analysis of single-file JavaScript or TypeScript CLIs that embed a JS runtime and application payload. This covers Bun `--compile`, Node single executable applications (SEA), `pkg`/`nexe`-style Node packagers, and Deno `compile`. Electron app bundles are out of scope; treat those as app/archive analysis.

## Contents

- [Triage Shape](#triage-shape)
- [Packager Fingerprints](#packager-fingerprints)
- [Static Workflow](#static-workflow)
- [Wrapper Package Inspection](#wrapper-package-inspection)
- [String And Surface Extraction](#string-and-surface-extraction)
- [Payload Feature Extraction](#payload-feature-extraction)
- [Evidence Rules](#evidence-rules)
- [Common Gotchas](#common-gotchas)
- [Useful Sources](#useful-sources)

## Triage Shape

Packaged JS CLIs usually have two layers:

1. A native executable container: Mach-O, ELF, or PE, plus code signing, dynamic imports, sections, resources, notes, and runtime libraries.
2. An embedded JS application payload: bundled/minified source, bytecode, snapshots, assets, virtual filesystems, sourcemaps, dependency strings, config keys, env vars, endpoints, and prompts.

Analyse the container first, then the JS payload. Native symbols often describe the runtime, not the app. Raw strings from runtime, dependencies, fixtures, and app code are interleaved, so classify strings as leads until tied to offsets, sections, or xrefs.

## Packager Fingerprints

### Bun single-file executable

Confirmed signals:

- Mach-O section/segment such as `__BUN,__bun`; on other formats, search for Bun runtime and filesystem markers.
- Strings such as `---- Bun! ----`, `/$bunfs/`, `globalThis.Bun`, `Bun.env`, `Bun.serve`, `JavaScriptCore`, `JSC`, and `build/release/tmp_modules/`.
- Embedded file imports can be rewritten to internal paths prefixed with `/$bunfs/`.
- Bun docs say `bun build --compile` bundles imported files/packages with a copy of the Bun runtime.

Useful commands:

```bash
otool -l <binary> | rg -n '(__BUN|__bun|segname|sectname|fileoff|filesize|offset|size)'
LC_ALL=C grep -aobF -- '---- Bun! ----' <binary>
LC_ALL=C grep -aobF -- '/$bunfs/' <binary>
strings -a -n 8 <binary> > /tmp/re-<target>/strings.txt
rg -n 'Bun|JavaScriptCore|JSC|build/release/tmp_modules|/\$bunfs/' /tmp/re-<target>/strings.txt
```

macOS signing is mutable after build. Capture current `codesign` and `spctl` state, but do not treat ad-hoc signing or rejection as proof of upstream distribution state.

### Node SEA

Confirmed signals:

- `NODE_SEA_BLOB` embedded as a PE resource, Mach-O section in a `NODE_SEA` segment, or ELF note.
- `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` fuse string, usually flipped from `:0` to `:1` after injection.
- Node/V8/libuv strings and normal Node dynamic library/dependency patterns.

Useful commands:

```bash
LC_ALL=C grep -aobF -- 'NODE_SEA_BLOB' <binary>
LC_ALL=C grep -aobF -- 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' <binary>
otool -l <binary> | rg -n 'NODE_SEA|NODE_SEA_BLOB'       # Mach-O
readelf -n -S <binary> | rg -n 'NODE_SEA|NODE_SEA_BLOB'  # ELF
objdump -x <binary> | rg -n 'NODE_SEA|NODE_SEA_BLOB'     # PE/COFF when available
```

Node SEA is a better claim than generic "Node binary" only when the SEA blob/fuse/resource evidence is present.

### `pkg` and `nexe`-style Node packagers

Likely signals:

- `pkg`: `/snapshot/` paths, `process.pkg`, `process.pkg.entrypoint`, `process.pkg.defaultEntrypoint`, `.pkg-cache`, or `PKG_CACHE_PATH`.
- Bundled Node/V8 runtime strings plus virtual filesystem paths.
- Native addon strings may exist, but native addons often need extraction or temporary files at runtime.

Use caution:

- `/snapshot/` can appear in unrelated bundled JS, test fixtures, or dependency text. Treat it as `Present` until paired with `process.pkg` or packager-specific runtime code.
- `pkg` is archived/deprecated upstream, but old binaries and forks remain common.

### Deno compile

Likely signals:

- `denort`, `DENORT_BIN`, `DENO_DIR`, `Deno.`, `deno compile`, or Deno permission/runtime strings.
- Deno docs describe compiled executables as using `denort`, a stripped runtime that embeds the program.
- Self-extracting builds can write embedded files to platform data directories on first run.
- macOS compiled executables are ad-hoc signed by default according to Deno docs.

Useful commands:

```bash
strings -a -n 8 <binary> > /tmp/re-<target>/strings.txt
rg -n 'denort|DENORT_BIN|DENO_DIR|Deno\.|deno compile|self-extracting' /tmp/re-<target>/strings.txt
```

## Static Workflow

1. Create an isolated workspace:

   ```bash
   mkdir -p /tmp/re-<target>
   ```

2. Baseline the native container:

   ```bash
   file <binary>
   shasum -a 256 <binary>        # macOS
   sha256sum <binary>            # Linux
   strings -a -n 8 <binary> > /tmp/re-<target>/strings.txt
   ```

3. Inspect loader/container metadata:

   ```bash
   otool -hv <binary>            # Mach-O
   otool -L <binary>             # Mach-O dylibs
   otool -l <binary>             # Mach-O sections/segments
   codesign -dv <binary>         # macOS current signing state
   codesign --verify -vvv <binary>
   spctl -a -vvv -t execute <binary>
   readelf -h -S -l -n <binary>  # ELF
   objdump -x <binary>           # PE/COFF or ELF fallback
   ```

4. Classify the packager with at least one high-signal marker:

   ```bash
   rg -n '(__BUN|/\$bunfs/|NODE_SEA_BLOB|NODE_SEA_FUSE|process\.pkg|/snapshot/|denort|DENO_DIR)' /tmp/re-<target>/strings.txt
   ```

5. Map important byte offsets back to sections:

   ```bash
   LC_ALL=C grep -aobF -- '<needle>' <binary> | head
   ```

   For Mach-O, compare offsets against `otool -l` `fileoff`/`filesize` or section `offset`/`size`. Report whether each marker is inside the app payload section, runtime text, linkedit/signature data, or outside a recognised payload.

6. Keep the result static unless the user explicitly permits execution. Do not run unknown CLIs just to get `--version`.

## Wrapper Package Inspection

Many packaged CLIs are distributed inside an npm-style wrapper even when the runtime payload is a native executable. Inspect nearby package files before deep decompilation:

```bash
realpath <binary>
find -L "$(dirname "$(realpath <binary>")")/.." -maxdepth 3 -type f \
  \( -name package.json -o -name README.md -o -name 'install.cjs' -o -name 'cli-wrapper.cjs' \) -print
```

Useful leads:

- `package.json`: package name, version, optional native platform packages, `bin`, `postinstall`, and distribution shape.
- `install.cjs`: whether the install hard-links, copies, wraps, downloads, or patches the native binary.
- `cli-wrapper.cjs`: fallback execution path, supported platforms, env passthrough, and error handling.
- `README.md` / `LICENSE.md`: intended public installation path and provenance.

Treat wrapper files as distribution evidence. They can explain how the binary was placed on disk, but they do not prove runtime behaviour inside the compiled payload.

## String And Surface Extraction

Run extractors against saved `strings.txt`, not directly against terminal output. Avoid printing credential-like values verbatim.

### Environment variables

```bash
python3 - <<'PY'
import pathlib, re
text = pathlib.Path('/tmp/re-<target>/strings.txt').read_text(errors='replace')
pattern = r'\b[A-Z][A-Z0-9_]{2,}\b'
names = sorted(set(re.findall(pattern, text)))
for name in names:
    if any(token in name for token in ['KEY', 'TOKEN', 'SECRET', 'PASSWORD']):
        print(name + '\tcredential-like-name')
    elif name.startswith(('NODE_', 'BUN_', 'DENO_', 'PKG_', 'NO_', 'FORCE_', 'DISABLE_')):
        print(name)
PY
```

Report secret-looking names as names only, not values. Raw env-var names are `Present` unless code flow proves they are read.

Large runtime bundles produce many crypto, protocol, and test-fixture false positives. For app behaviour, do a second pass focused on product-specific prefixes, vendor names, and strings near feature keys; report broad runtime constants separately or omit them from the behavioural summary.

### URLs and domains

Binary strings often include malformed URLs, templates such as `${...}`, documentation examples, and concatenated literals. Parse defensively:

```bash
python3 - <<'PY'
import collections, pathlib, re, urllib.parse
text = pathlib.Path('/tmp/re-<target>/strings.txt').read_text(errors='replace')
domains = collections.Counter()
examples = {}
for raw in re.findall(r'https?://[^\s"\'`<>)]{3,}', text):
    try:
        parsed = urllib.parse.urlsplit(raw)
    except ValueError:
        continue
    host = parsed.netloc.lower()
    if not host or any(ch in host for ch in '${}'):
        continue
    domains[host] += 1
    clean = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, '', ''))[:160]
    examples.setdefault(host, clean)
for host, count in domains.most_common(80):
    print(f'{count}\t{host}\t{examples[host]}')
PY
```

Treat URL/domain results as a surface inventory. Claim network behaviour only after xrefs or reachable call paths support it.

### Packager marker summary

```bash
for marker in '__BUN' '---- Bun! ----' '/$bunfs/' \
  'NODE_SEA_BLOB' 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' \
  '/snapshot/' 'process.pkg' 'denort' 'DENO_DIR'; do
  printf '%-58s ' "$marker"
  LC_ALL=C grep -aF -m 1 -- "$marker" /tmp/re-<target>/strings.txt >/dev/null \
    && echo present || echo absent
done
```

## Payload Feature Extraction

Once the packager is classified, switch from broad string search to feature-focused payload extraction. Packaged JS often stores minified application code on very long lines; `rg` output can be too noisy or truncated. Use byte offsets and bounded context around important needles.

```bash
LC_ALL=C grep -aobF -- '<feature-key-or-flag>' <binary> | head -20
```

For repeated context extraction:

```bash
python3 - <<'PY'
from pathlib import Path

binary = Path('<binary>')
needles = [b'<feature-key>', b'<cli-flag>', b'<api-method>']
data = binary.read_bytes()

for needle in needles:
    print(f'\n== {needle.decode("utf-8", "replace")} ==')
    start = 0
    seen = 0
    while True:
        idx = data.find(needle, start)
        if idx < 0 or seen >= 8:
            break
        lo = max(0, idx - 400)
        hi = min(len(data), idx + 700)
        snippet = data[lo:hi].decode('utf-8', 'replace')
        snippet = ''.join(
            ch if ch in '\n\t' or 32 <= ord(ch) < 127 else ' '
            for ch in snippet
        )
        print(f'-- offset {idx} --')
        print(snippet.replace('\n', '\\n')[:1200])
        start = idx + len(needle)
        seen += 1
PY
```

High-signal feature surfaces:

- Config default maps: setting names, defaults, visibility, descriptions, and scope.
- CLI option descriptor arrays: hidden flags, incompatibilities, mode dispatch, and user-facing errors.
- API schema objects: request/response shapes and enum values.
- State-machine classes: status states, lifecycle methods, error branches, and delegate callbacks.
- Persistence code: data directory construction, file modes, JSON shapes, cache paths, PID locks, and migration cleanup.
- Transport setup: registration payloads, credential fetchers, session IDs, reconnect hooks, and shutdown paths.

When tracing filesystem locations, search both config and state roots:

```bash
rg -n 'XDG_DATA_HOME|XDG_CACHE_HOME|XDG_CONFIG_HOME|\.config|\.local/share|\.cache|settings\.json|pids|logs' /tmp/re-<target>/strings.txt
```

Confirm which path stores identity/state and which path stores logs/cache before reporting. Similar-looking variables can point to different roots in different modules.

### Desired-State Runner Pattern

Some CLIs expose local executors to a web service by maintaining an outbound session rather than opening an inbound local server. Useful static signs:

- Registration payload includes a stable local ID, session ID, hostname, working directory, repository URL, PID, and running item IDs.
- Local state persists served item IDs across restarts.
- The service sends desired-state intents such as running/stopped rather than direct shell commands.
- The local process reconciles intents idempotently by attaching and detaching executors.
- A per-directory or per-workspace PID claim prevents duplicate runners.
- Shutdown unregisters the session, disposes clients/listeners, and releases the local claim.

Describe this as a reconciliation loop unless code flow proves one-shot command execution.

## Evidence Rules

- **Confirmed**: container facts (`file`, hash, section/resource/note layout), packager markers in expected binary locations, code signing state, or code/data xrefs.
- **Likely**: multiple packager-specific strings align but the exact payload structure is not fully mapped.
- **Present**: strings, URLs, env vars, package names, prompts, model names, feature flags, or paths found without usage proof.
- **Unclear**: conflicting packager markers, malformed sections, packed/compressed payloads, or tooling disagreement.

Prefer claims like:

- "Confirmed Bun single-file executable: Mach-O `__BUN,__bun` section plus Bun runtime strings."
- "Present: domains `api.example.test` and `docs.example.test` in string inventory."
- "Likely `pkg` binary: `/snapshot/` paths plus `process.pkg.defaultEntrypoint`."

Avoid claims like:

- "Calls `api.example.test`" from raw URL strings alone.
- "Uses model X" from adjacent model-name strings alone.
- "Unsigned by vendor" when local ad-hoc signing or post-build patching could have changed the file.

## Common Gotchas

- Packaged JS binaries are often large because they include a runtime. Size alone is not evidence of obfuscation.
- Native symbol tables usually describe V8/JSC/Bun/Deno/Node runtime code, not application logic.
- Sourcemaps can be embedded, external, compressed, or absent. `sourceMappingURL` and `sourcesContent` are useful leads, not guarantees.
- Bytecode or snapshots can improve startup without hiding all source strings.
- `/snapshot/` is not exclusive to `pkg`; require corroborating `process.pkg` or packager runtime evidence.
- Code signing and notarisation state can change when tools patch, inject, or re-sign binaries. Record current state and avoid provenance overclaims.
- Dependency docs, examples, tests, and SDK fixtures often contain URLs and env vars. Separate "surface inventory" from "behavioural claim".

## Useful Sources

- Bun single-file executable docs: <https://bun.com/docs/bundler/executables>
- Node.js single executable applications: <https://nodejs.org/api/single-executable-applications.html>
- Vercel `pkg` README: <https://github.com/vercel/pkg>
- Deno `compile` docs: <https://docs.deno.com/runtime/reference/cli/compile/>
- Node.js `postject`: <https://github.com/nodejs/postject>
