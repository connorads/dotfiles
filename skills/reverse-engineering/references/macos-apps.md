# macOS Disk Image, App Bundle, and Native Binary Reference

Use this reference for static analysis of DMGs, `.app` bundles, Mach-O
executables, and native Swift or Objective-C applications. Treat the target as
four layers:

```text
disk-image container -> app-bundle topology -> native binaries -> resources
```

Do not infer one layer from another. A signed app can contain unused resources;
a linked framework does not prove a feature is reachable; and a string does not
prove runtime behaviour.

## Safety Boundary

Mounting a DMG does not normally launch an application. It does make macOS parse
an attacker-controlled disk-image container and filesystem, so it is a larger
attack surface than container-only inspection.

- Hash, identify, and verify the image before mounting.
- Mount only with user permission. Use read-only, no-browse, and no-auto-open
  flags, even when a flag matches the current system default.
- Do not use Finder, Quick Look, `open`, or any executable from the target.
- Do not follow symlinks out of the mounted volume or app bundle.
- Detach in cleanup even when later inspection fails.
- For hostile or genuinely unknown malware, inspect inside a disposable VM
  rather than mounting on the host.

The bundled helper enforces this boundary and is the default:

```bash
python scripts/macos_app_triage.py <target> --out /tmp/re-<target>
python scripts/macos_app_triage.py <image.dmg> \
  --allow-mount --out /tmp/re-<target>
```

The first DMG command inspects and verifies the container without mounting it.
`--allow-mount` performs this attach sequence:

```bash
hdiutil attach \
  -readonly \
  -nobrowse \
  -noautoopen \
  -mountpoint <isolated-mountpoint> \
  -plist \
  <image.dmg>
```

It supplies no stdin, never launches the target, and detaches the mountpoint in
a `finally` path. Do not replace this with a Finder double-click.

## Establish the External Baseline

Before deep analysis, search official product documentation, changelogs,
release feeds, privacy statements, and public repositories. Record an expected
feature matrix, then keep public claims separate from binary evidence.

This avoids presenting documented behaviour as a reverse-engineering discovery
and makes genuine implementation findings visible. Do not carry volatile
release facts into standing skill prose.

## Inspect the DMG Container

Use the container-native parser before trusting generic format detection:

```bash
shasum -a 256 <image.dmg>
hdiutil imageinfo -plist <image.dmg> > imageinfo.plist
hdiutil verify <image.dmg>
```

UDIF images can begin with compressed chunks that cause `file` or a compressor
test to describe the first chunk rather than the whole image. A `file` result
such as bzip2 data and a compressor warning about trailing bytes do not prove
the image is malformed. Reconcile them with `hdiutil imageinfo` and the UDIF
trailer before making a format claim.

Record these container facts independently:

- Whole-image hash and byte size.
- UDIF format and compression.
- Partition and filesystem types.
- Encryption state.
- Checksum and verification result.

## Inventory the App Bundle

Read `Contents/Info.plist` first. It identifies the main executable and often
reveals document types, URL schemes, minimum OS version, update feeds, privacy
usage strings, and bundled component versions:

```bash
plutil -p <App.app>/Contents/Info.plist
```

Inventory without `find -L` or any other symlink-following option:

```text
Contents/MacOS
Contents/Frameworks
Contents/PlugIns
Contents/XPCServices
Contents/Helpers
Contents/Library/LoginItems
Contents/Resources
```

Record nested executables, frameworks, plug-ins, XPC services, helper apps,
shell integrations, fonts, themes, archives, source maps, configuration files,
and licence notices. Plaintext scripts and web resources can expose application
logic more directly than native decompilation, but presence remains weaker than
reachable code flow.

## Separate Signing Claims

Run signing and policy checks separately because they answer different
questions:

```bash
codesign -d --verbose=4 <App.app>
codesign -d --entitlements :- <App.app>
codesign --verify --deep --strict --verbose=4 <App.app>
spctl -a -vvv -t execute <App.app>
```

- `codesign -d` reports the current signature and designated identity.
- `codesign --verify` checks structural and cryptographic validity.
- Entitlements declare capabilities; they do not prove those capabilities are
  exercised.
- `spctl` reports the current execution-policy assessment.
- Notarisation, signature validity, policy acceptance, and behavioural trust
  are distinct claims.

Check important nested code independently when its provenance or entitlements
matter. Never turn “signature valid” into “application safe”.

## Inspect Each Mach-O Slice

Start with Apple tools because third-party parsers can lag current load commands,
Swift metadata, or universal-binary layouts:

```bash
file <binary>
lipo -archs <binary>
xcrun dwarfdump --uuid <binary>
xcrun vtool -show-build <binary>
otool -hv <binary>
otool -L <binary>
otool -l <binary>
/usr/bin/nm -a <binary> > symbols.txt
xcrun swift-demangle < symbols.txt > swift-symbols.txt
```

Use `/usr/bin/nm` explicitly on macOS. A GNU or Homebrew `nm` earlier in `PATH`
can reject Apple flags or parse Mach-O differently.

For Objective-C metadata:

```bash
dyld_info -arch <architecture> -objc <binary>
```

Inspect Swift reflection sections such as `__swift5_types`, `__swift5_reflstr`,
and `__swift5_fieldmd`, plus Objective-C class and selector metadata. Mixed
Swift and Objective-C metadata is normal in native applications.

Treat “stripped” as a claim about a particular symbol table or parser, not as
proof that useful names are absent. If one tool reports a stripped binary,
still try Apple `nm`, Swift demangling, `dyld_info`, reflection sections, local
symbols, debug-map records, and strings. Record contradictory tool results.

For universal binaries, keep architecture beside every address and
decompilation claim. When a workbench needs a thin slice, extract it into the
analysis workspace rather than modifying the target:

```bash
lipo <binary> -thin arm64 -output /tmp/re-<target>/binary.arm64
```

## Classify Frameworks and Resources Carefully

Framework and resource combinations are useful classifiers:

- AppKit or SwiftUI plus Swift/Objective-C metadata indicates a native Apple UI.
- WKWebView or WebKit resources inside a native app indicate embedded web
  content, not Electron or Tauri by themselves.
- Electron needs corroborating topology such as Electron Framework and
  `Resources/app.asar`.
- Runtime libraries can be linked for a narrow feature; linkage alone does not
  establish the application’s architecture.

Full Electron and Tauri payload workflows are not bundled yet. When those
fingerprints appear, complete the generic container, bundle, signing, and
resource inventory; state the runtime-specific coverage limit instead of
improvising a confident extraction recipe.

## Evidence Examples

| Claim | Appropriate evidence |
|---|---|
| DMG uses a particular compression | `hdiutil imageinfo`, container metadata |
| App is signed by an identity | `codesign -d` |
| App passes current policy assessment | `spctl` result |
| Swift type or method exists | demangled symbol or reflection metadata |
| Objective-C class or selector exists | `dyld_info -objc` |
| Framework is linked | Mach-O load command |
| Feature executes | reachable xref or control/data-flow, not linkage alone |
| URL or entitlement is present | plist/resource/signature metadata only |
