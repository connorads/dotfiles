# Android APK Reference

Use this reference for static analysis of Android apps: `.apk`, `.xapk`, `.apks`,
`.apkm`, `.aab`, and bare `.dex`. Treat the target as four layers:

```text
distribution container -> split set -> DEX (Java/Kotlin) -> resources + native libs
```

Do not infer one layer from another. A class present in the DEX is not a reachable
feature; a hostname in `strings.xml` is not a called endpoint; and the base APK is
not necessarily all the code.

## Tool Ladder

1. **Get a JDK before anything else.** jadx needs Java 11+; `apkeep` and
   `APKEditor` need their own runtimes.

   On macOS `command -v java` is a **false positive**: `/usr/bin/java` is a stub
   that exists with no JDK installed and fails at run time with
   `Unable to locate a Java Runtime`. Detect properly:

   ```bash
   if JH=$(/usr/libexec/java_home 2>/dev/null) && [ -x "$JH/bin/java" ]; then
     "$JH/bin/java" -version
   elif java -version >/dev/null 2>&1; then
     java -version          # version-manager JDK (mise/SDKMAN/brew) outside java_home
   else
     echo "no JDK"          # install one, or run the tool under a provisioned JDK
   fi
   ```

   With nix available, provisioning beats installing:
   `nix shell nixpkgs#jdk21 -c <command>`.

2. **Acquire the APK**

   ```bash
   apkeep -l -a <package.id>                 # list available versions first
   apkeep -a <package.id> .                  # default source: apk-pure
   adb shell pm path <package.id>            # on a device: lists base + splits
   ```

   The package id is the `id=` parameter of the Play Store URL.

   Two properties of store mirrors matter. They **lag the store**, so check the
   version you got against the listing before reporting anything version-specific.
   And Play serves **per-device splits**, so the set you receive depends on the
   profile the downloader claims.

3. **Give the decompiler the whole container**

   ```bash
   jadx -d out <app.xapk>        # .apk .xapk .apks .apkm .aab .dex .jar all accepted
   ```

   jadx 1.5+ reads split containers directly and merges DEX across their entries
   (verified 2026-08-16 against jadx 1.5.3: decompiling a `.xapk` and decompiling
   its unzipped `base.apk` produced identical output).

   Do **not** unzip a container and point the decompiler at `base.apk`. Code
   normally lives only in `base.apk` — `config.*` splits carry native libraries,
   localised strings, and density resources — but an app using **dynamic feature
   delivery** ships a feature module's DEX in its own split. Picking `base.apk`
   by hand silently drops that code, and the symptom is subtle: a class is
   referenced but its package is absent from the tree.

   Where jadx mishandles a split set, merge first:

   ```bash
   java -jar APKEditor.jar m -i <app.xapk> -o merged.apk && jadx -d out merged.apk
   ```

4. **Expect a non-zero exit from a successful run.** jadx reports
   `finished with errors, count: N` and exits `1` when individual classes fail to
   decompile — a handful out of thousands is normal and the output is complete
   enough to work with. Judge the run by the class count on disk, not the exit
   code:

   ```bash
   find out/sources -name '*.java' | wc -l
   ```

5. **Decode resources separately when you need them**

   ```bash
   apktool d -o out_res <app.apk>
   ```

   jadx reconstructs many resources, but `apktool` is authoritative for
   `resources.arsc`, the manifest, and `res/xml/`. If you ran jadx with
   `--no-res`, you have no resources at all — a later hunt for a hostname in
   `strings.xml` will come up empty for the wrong reason.

   A split container also carries a `manifest.json` describing the set. Reading it
   costs nothing and gives package id, `version_code`, `version_name`, min/target
   SDK, and the permission list without invoking a tool.

## Detect Hybrid Application Runtimes

DEX may contain only the platform shell. Before treating the Java/Kotlin tree
as the application, inspect APK assets and native libraries for a second
runtime:

```bash
find out/resources -type f | \
  rg '/assets/.*(index\.android\.bundle|\.bundle|\.hbc|\.js)$|libflutter\.so'
```

For React Native, read `MainApplication` to establish whether Hermes is
enabled, then identify the bundle:

```bash
file out/resources/<base-apk>/assets/index.android.bundle
```

If it is Hermes bytecode and `uvx` is available, decompile it separately:

```bash
uvx --from 'hermes-dec>=0.1.2' hbc-decompiler \
  out/resources/<base-apk>/assets/index.android.bundle \
  /tmp/re-<target-name>/decompiled.js
```

`hermes-dec` support is bytecode-version-specific. Version 96 requires 0.1.2
or newer; check the version reported by `file` against the tool's release notes
for other versions. If `uvx` is unavailable, use another isolated Python
environment rather than installing into the system interpreter.

Treat the layers separately:

- Java/Kotlin may define activities, native modules, and platform bridges.
- Hermes may hold application workflows, API calls, models, and export logic.
- A native method proves that JavaScript can call the bridge, not that a
  particular screen reaches it.

Raw strings from Hermes are leads only. Adjacent constants are commonly
concatenated from unrelated functions. Confirm important findings in
decompiled functions or disassembly.

## Working an Obfuscated Tree

Assume R8. It is the default from AGP 3.4 and AGP 8.x offers no supported way to
substitute ProGuard, so treat every modern release build as R8-processed.

R8 renames the app's own classes to `a`, `b`, `C0427o`. It does **not** rename
several categories, and those are the way in:

| Survives renaming | Why |
|---|---|
| Third-party library packages (`okhttp3`, `retrofit2`, `com.squareup.*`, `io.ktor`, `com.parse`) | The library's own consumer keep-rules preserve its public API |
| Manifest-declared components | Activities/Services/Receivers/Providers are the graph roots |
| Native (JNI) method names | Must match the `.so` symbol |
| `Parcelable.CREATOR`, `Serializable` members, enum `values()`/`valueOf()` | Resolved reflectively by the framework |
| `@Keep` and anything with a keep rule | Explicitly preserved — and the rule itself leaks intent |
| String literals, resource names | Stock R8 does not encrypt strings or rename resource entries |

**So the first move on an obfuscated tree is to find what is not obfuscated.**
A vendored SDK keeps its names, and a developer's own model or networking library
frequently does too:

```bash
find out/sources -maxdepth 3 -type d | grep -Ev '/[a-z0-9]{1,2}$' | sort
```

Deep, English, dotted packages are readable code; single- and double-letter
packages are the app. In practice one readable package is worth more than the
whole obfuscated remainder, because it names the domain in the app's own words.

## Recovering the API Surface

### Bound it, do not enumerate it

Guessing endpoint names from strings gives you "at least these". Grepping the
importers of the client SDK's entry class gives you a **closed set**:

```bash
rg -l 'import com\.parse\.ParseCloud' out/sources     # every caller, hence every call
rg -l 'okhttp3|retrofit2|io\.ktor|com\.android\.volley' out/sources
```

If five files can reach the API, the surface is whatever those five files call,
and you can say so with confidence. State the bounding argument alongside the
list — "complete for statically-declared calls" is a much stronger claim than an
unqualified inventory, and an honest one.

The surface is only partial if URLs are assembled at run time, delivered by the
server, reached through reflection, or built in native code. Check before
claiming completeness:

```bash
rg -n '\.url\(|Uri\.parse\(|String\.format\(.*http|HttpURLConnection' out/sources
```

### Framework-specific anchors

- **Retrofit** — the interface annotations *are* the API documentation. Method
  signatures give paths, query and body field names, and the model types whose
  fields are the JSON keys.

  ```bash
  rg -h '@(GET|POST|PUT|DELETE|PATCH|HTTP)\b' out/sources | sort -u
  ```

- **OkHttp** — `Request.Builder().url(...)`; interceptors are where auth headers
  and API keys are attached.
- **Parse / Volley / Ktor** — find the client initialisation call; it carries the
  server URL and any application/client keys.

### Find the environment-switch class

Follow the client initialisation to the constant that supplies its base URL, then
read that class whole rather than grepping it. Apps routinely hold production,
staging, and emulator-loopback hosts in one enum or switch, so one file yields
the live host *plus* infrastructure that appears nowhere else. Names to expect:
`Environment`, `Config`, `Endpoints`, `BuildEnv`, or an obfuscated single letter
reached from the init call.

`BuildConfig` is the other constant store worth reading in full:

```bash
find out/sources -name 'BuildConfig.java' -exec grep -HnE '"https?://|URL|KEY|SECRET|TOKEN' {} +
```

### Find the class that enumerates the schema

Before collecting field names by hand, look for the one place the app already
lists them. ORMs and serialisers centralise this: a `getCustomKeys()`-style
method, `@SerializedName` annotations, Moshi/Room/Realm declarations, or a base
model class holding the sync metadata every record carries. One such method can
give a complete, correctly-spelled field list for every entity — far better
evidence than strings, and it distinguishes wire names from local ones.

### Read the network security config

```bash
rg networkSecurityConfig out_res/AndroidManifest.xml
cat out_res/res/xml/network_security_config.xml
```

`<domain-config>` entries name the real API hosts and any pinned certificates.

## Evidence Discipline

**A grep pipeline is not a citation.** Confirm every load-bearing literal —
hostname, application id, key, field name, numeric constant — by reading the file
at the offset, not by trusting terminal output. Search to locate; read to quote.
This costs one extra tool call per claim and is the difference between a spec
someone can implement and one that fails on first use.

**An empty result is a claim about your command, not about the target.** A
mistyped path, an unquoted glob the shell ate, or a wrong `--include` produces the
same silence as genuine absence. Before reporting a field or endpoint as missing,
reproduce the negative a second way — a different tool, a broader pattern, or a
live request.

**A constant read from the app is a client default, not a server limit.** Page
sizes, batch sizes, timeouts, and retry counts found statically tell you what this
client chooses. They do not tell you what the server permits, and the two are
routinely different. Label them as client behaviour unless a live probe
establishes the ceiling.

**Guard universal quantifiers.** "The app sends only X" is a much stronger claim
than "the app sends X", needs correspondingly stronger evidence, and is the
single most common way a nearly-correct static finding becomes wrong.

## Known Dead Ends

- **Pinning a bundled SDK's version from bytes.** A vendored SDK's classes
  usually carry no version constant, and only some libraries ship a
  `META-INF/*.version` marker. Time-box this. If a `META-INF` marker and an
  obvious version constant both come up empty, stop grepping and either
  fingerprint class shapes against upstream tags or record the version as
  unproven — it is rarely load-bearing anyway.

## Sources

- jadx: <https://github.com/skylot/jadx>
- apktool: <https://apktool.org> · <https://github.com/iBotPeaches/Apktool>
- apkeep: <https://github.com/EFForg/apkeep>
- APKEditor (split merging): <https://github.com/REAndroid/APKEditor>
- R8 shrinking and obfuscation: <https://developer.android.com/build/shrink-code>
- R8 keep rules: <https://android-developers.googleblog.com/2025/11/configure-and-troubleshoot-r8-keep-rules.html>
- Android App Bundle and splits: <https://developer.android.com/guide/app-bundle>
- macOS Java stub: <https://mac.install.guide/java/unable-to-locate>
