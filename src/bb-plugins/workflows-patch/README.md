# BB bundle patch registry

The desktop registry prepares exact BB 0.47.1 and 0.48.1 bundles without compiling BB or a bundled plugin.
Desktop 0.48.1 has only a draft `session-options` manifest. Its `start-server.js` differs from the npm package the 0.48.1 activity recipe pins.
The manager inspects explicit installations and verifies copied candidates.
Its apply and restore commands admit only disposable copies beneath the operating system's canonical user temporary directory.
They never reload plugins, restart servers or invoke an updater.

| Set | Changes | Activation requirement |
| --- | --- | --- |
| `session-options` | Workflows server, progress view and authoring guide | Server and desktop view activation |
| `activity` | Core aggregation and Workflows server | Full server activation |
| `session-options-plus-activity` | Session options, then activity | Full server and desktop view activation |

Session options remain independent of activity. The combined manifest pins both intermediate and final tuples.
Every manifest guards core, Workflows server, progress view and authoring guide, including unchanged files.
The release adapter contains the reviewed transformations. Historical private archives never supply executable recipes.

```mermaid
flowchart LR
  Observe[Observe explicit app] --> Classify{Complete tuple recognised}
  Classify -->|Unknown or mixed| Block[Block preparation and mutation]
  Classify -->|Known| Prepare[Generate from pristine bytes]
  Prepare --> Verify[Regenerate and execute offline harnesses]
  Verify --> Copy[Exercise disposable transactions]
  Copy --> Disk[Installed pending activation]
  Disk --> Separate[Activation remains separate]
```

## Inspect and prepare

The dual-mode [bb-patch wrapper](../../../.config/zsh/functions/patch/bb-patch) calls
[the Python manager](scripts/bb_patch.py). Run `zfn-link` after installing the wrapper.
Every new installation command requires an absolute `--app` path.
Identity comes from that app's plist, Mach-O executable and complete bundle tuple.
`BB_CLI`, the calling process and mise's separate `bb-app` package do not identify the desktop.

```sh
bb-patch inspect --app /Applications/bb.app --require-set session-options-plus-activity --json
bb-patch prepare --app /Applications/bb.app --set session-options-plus-activity --output /private/tmp/bb-candidate-review
bb-patch verify --plan /private/tmp/bb-candidate-review/plan.json
```

Preparation requires a fresh output directory outside the installation, with no ancestor overlap or symlink targets.
It writes all four candidate files, a pristine input tree and `plan.json`. It leaves installation bytes and metadata unchanged.
Preparing from a recognised patched installation requires verified pristine objects in the manager's private object store.
The manager never reverses text replacements.
Unknown releases or bytes block executable preparation, even when text anchors match.

Candidate identity hashes canonical JSON containing the complete recipe, input digests and candidate tuple.
Installation paths and filesystem identity sit in a separate binding.
Repeated preparation produces identical candidate bytes and identity.
Verification checks the current tracked manifest, adapter and harness digests, regenerates every intermediate tuple, then executes the harnesses.
A saved success flag cannot substitute for execution.
`verification.json` binds completed offline checks to candidate, manifest, adapter and harness digests.
Verification rechecks bytes and inputs after harness execution. Activation and runtime status remain unknown.

Inspection returns these statuses:

| Exit | Meaning |
| --- | --- |
| `0` | Recognised complete tuple. Any required capabilities are present. |
| `1` | Recognised complete tuple. Required capabilities are missing. |
| `2` | Unknown, mixed, missing, unsafe or invalid installation or registry. |

The combined set satisfies either constituent requirement. Requiring the combined set requires both patches.
JSON reports observation, complete-tuple classification, observed and required sets, missing patches and pending transactions.
Activation and runtime verification remain `unknown`. Offline verification cannot establish either.
Known per-file mixtures remain unhealthy. Legacy session-options mixtures and journal-backed mixtures remain distinct.

## Private server packages

`prepare-package` prepares a mise-backed server package without changing its installation.
It accepts an absolute package directory and Node executable. The output is a private release store.

```sh
bb-patch prepare-package --package /absolute/mise/node_modules/bb-app \
  --node /absolute/node/bin/node --output /absolute/private/bb-releases \
  --set session-options-plus-activity
```

Package preparation selects a separate session-options and activity recipe for npm BB `0.48.1`.
Admission requires version `0.48.1` and these pristine SHA-256 digests:

| File under `server/dist` | SHA-256 |
| --- | --- |
| `start-server.js` | `41ffbb6d40eafb1253242e529b1032a7043d29e0cf0eb1c03d6d3c11e2c0a1d7` |
| `builtin-plugins/workflows/dist/server.js` | `013bd3bb37daf4b682f408dcff633dfec1ae49a851f72aab2fe1f5b40381341b` |

A digest mismatch retains every requested feature's stock bytes.
The `0.48.1` session-options recipe is the `0.47.1` recipe with the release's minified bindings.
Its harness, `scripts/test-bundle-0.48.1.mjs`, exports and calls those bindings.
Other versions try the existing `0.47.1` transformations and harnesses.
Version `0.48.2` receives no `0.48.1` recipe by anchor matching.
Each feature must pass syntax checks and its existing offline behaviour harness before publication.
An incompatible feature retains its original files. Other requested features still run.
Missing patch targets also retain stock files. Missing runtime layout or failed copying blocks preparation.
Checks have a 60-second timeout. A timeout retains the stock feature.

The JSON result reports `patched`, `partial` or `stock`, applied features, failures and before/after hashes.
Its identity includes complete source and result trees, dependency location, Node version, recipe and harness digests.
The `0.48.1` provenance includes both adapters because it reuses the pinned core transform.
Changing shared preparation code changes identities for every version, including `0.48.0`; prepare fresh releases.
Repeated preparation reruns checks and refuses changed runtime files in an existing release.
The source package remains unchanged. Preparation never starts a server or activates a release.
Source preservation establishes no upstream authenticity. The copy and identity include every package entry, including unexpected local directories.
Candidates from a modified installation require review against a verified pristine package before release selection.

Each release contains a copied package and a dependency link to its installed source.
Deployment retains the source's mise pins so pruning preserves those dependencies.
The store retains releases for explicit recovery. It does not delete them automatically.
The [deployment guide](../../../docs/remote-access.md) owns selection and activation.

Desktop `inspect`, `prepare`, `verify`, `apply` and `restore` retain their exact-release admission rules.
Package preparation does not grant live desktop mutation authority or change application signatures.

## Offline checks

```sh
python3 -B -m unittest discover -s scripts -p 'test_*.py'
```

Independent synthetic registry and transaction fixtures run without `/Applications/bb.app`.
Release tests skip explicitly unless `BB_PATCH_RELEASE_APP` names a verified disposable release copy.
That copy needs the four guarded files, `Contents/Info.plist` and `Contents/MacOS/bb` from the same release.

```sh
BB_PATCH_RELEASE_APP=/absolute/system-temporary-directory/release/bb.app python3 -B -m unittest discover -s scripts -p 'test_*.py'
```

The session harness resolves Zod and SDK imports from the adjacent `workflow-timers` package.
Workspace dependencies must already be installed. Node must provide `node:sqlite` for the activity harness.
The activity harness executes copied core and plugin fragments together against synthetic SQLite records.
It checks lifecycle counting, activation failure, invalidation, stale generations, source failures and progress publication.
The separate `0.48.1` harness resolves minified bindings through unique esbuild function labels.
It checks late registration refusal, terminal sidebar notifications, RPC invalidation tags and pristine plugin fragment equivalence.
These checks use copied fragments inside a synthetic API scaffold. They establish fragment behaviour alongside static caller audits.
They do not establish activity counts or realtime notification delivery through a running server.
Child-thread status lines use a separate count and exclude plugin workflows.
Syntax checks establish parsing only.
The scoped `workflows-patch` hook runs independent tests and validates tracked input fingerprints.
Copied-release behaviour remains an explicit check when release fixtures are absent.

The opt-in npm `0.48.1` test prepares activity and combined copies from the installed source.
It checks exact output hashes, session-options output, and unchanged source contents and metadata.
Set `BB_PATCH_NODE` to an installed Node executable with `node:sqlite`:

```sh
BB_PATCH_PACKAGE_0481=/absolute/mise/node_modules/bb-app \
  BB_PATCH_NODE=/absolute/node/bin/node \
  python3 -B -m unittest discover -s scripts -p test_package_0_48_1.py
```

An isolated server smoke check needs fresh temporary HOME and data directories, loopback ports, and no credentials or provider execution.
Enable Workflows only in that disposable instance; fresh data leaves it disabled.
An orphan reconciliation check may seed a queued run whose origin does not exist, then restart the disposable instance.
It establishes copied-server startup, an empty thread-list response and orphan cancellation without execution.
It does not establish sidebar counts or realtime notifications. Those require a real synthetic origin thread and observed count changes and notifications.
Live activation and runtime status remain unknown.

To measure the actual copied query and aggregation, set `BB_PATCH_MEASUREMENTS` to an evidence file:

```sh
BB_PATCH_MEASUREMENTS=/private/tmp/bb-query-measurements.json node scripts/test-activity.mjs /private/tmp/bb-candidate-review/start-server.js /private/tmp/bb-candidate-review/builtin-plugins/workflows/dist/server.js
```

The fixture has 100,000 rows, terminal history, many active origins and concentrated history.
Each active row contains 128 KiB of source text. The snapshot selects only run and origin IDs.
It measures seven repetitions for 100, 1,000 and 5,000 threads.
The initial review budget is 100 ms p95 at 5,000 threads.
The adapter uses one read-only active-run snapshot per aggregation, grouped by origin.
It keeps no persistent activity cache or database index.
Each source retains its last valid per-origin count only within its owning API generation.
A failed shared refresh emits one warning per aggregation. Per-origin validation errors retain their own diagnostics.
Without a previous valid snapshot, source failure raises `activity-source-unavailable` instead of returning zero.

## Disposable transactions and recovery

Only `approved-offline` manifests authorise copied-installation transactions. Draft recipes can prepare and verify candidates.
Offline approval grants no live installation authority.
Create disposable roots with Python's `tempfile` and resolve their paths before using them.
On macOS, admission uses `getconf DARWIN_USER_TEMP_DIR`, independent of `TMPDIR`.
The plan binds the exact root device, inode, release generation, metadata and complete input tuple.

```sh
bb-patch apply --app /absolute/system-temporary-directory/release/bb.app --plan /private/tmp/bb-candidate-review/plan.json
bb-patch restore --app /absolute/system-temporary-directory/release/bb.app --transaction <transaction-id>
```

Private state lives under `~/.local/share/bb-bundle-patches/manager/`:
`objects/` holds verified content-addressed pristine and pre-transaction bytes;
`transactions/` holds durable intent and progress;
`locks/` holds canonical-installation advisory locks.
Do not edit journals or substitute objects from another release.

The manager verifies backups before intent, stages every changed file, journals each replacement and checks actual hashes before replacement.
It preserves uid, gid, mode and supported extended attributes. It rejects ACLs, hard links, privileged modes and unsupported ownership.
Non-zero file flags block transactions before backup objects or journals.
Zero flags retain the existing metadata representation for plan and journal compatibility.
Replacement uses pinned parent-directory descriptors. A concurrent root replacement cannot redirect the rename into the replacement generation.
It verifies the complete final tuple, including unchanged guards.
Successful application records `installed-pending-activation`.

Recovery compares actual files with recorded before and after tuples. A crash after rename remains recoverable before progress recording.
Restore verifies both object tuples and installation identity before writing.
Unexpected bytes, missing objects or a replaced root block recovery and preserve destinations.
A write failure attempts restoration; failed restoration remains journalled for another explicit restore.
Repeated restoration is safe for recognised bytes.
To remove one feature, prepare the remaining complete set from pristine objects. Never restore a single shared server file.

States are `prepared`, `backed-up`, `installing`, `installed-pending-activation`, `restoring`, `restored` and `blocked-unexpected-bytes`.
A manager lock does not exclude Homebrew or the native updater.
Per-file rename is not application-wide atomicity. Process termination tests do not prove power-loss durability.
Restoring files does not reverse runtime record effects.
No command signs the app, removes quarantine or changes integrity controls.
Live installation remains blocked pending independent maintenance admission, updater exclusion and modified-app integrity evidence.

## Legacy session-options entrypoint

[patch-bundle.py](scripts/patch-bundle.py) preserves `check`, `prepare`, `apply` and `restore`, their flags, messages and output layout.
Its default app is `/Applications/bb.app`.
Its default output and backup root is `~/.local/share/bb-bundle-patches/workflows-daybreak-0.47.1`.
Prepared files sit directly under that root; verified stock backups sit under `backup/`.
The legacy entrypoint retains its existing mutation authority. The manager does not invoke it.

Legacy `check` accepts each of the three Workflows targets independently and requires stock core.
Its success can describe a mixed installation. Use manager inspection to assess a complete set or required capability.
Legacy apply and restore retain verified backup recovery for mixed session-options targets.
Unknown bytes or corrupt backups refuse writes. Legacy restoration does not reinterpret activity or combined sets.

Session options accept boolean and select values, validate fixed settings and reach direct worker spawning.
Absent options preserve stock cache identity. Explicit empty options preserve historical patched identity.
Stored labels support progress without a live provider catalogue.
Patched readers accept stock and historical option records, and preserve origin ownership checks.
Stock readers cannot preview every historical patched record after file restoration.
Installer database writes and runtime record compatibility are separate claims.

## Updates, porting and retirement

`up` performs advisory inspection after standalone Homebrew and applicable macOS activation paths, including failures and frozen activation.
Inspection never prepares, installs or activates patches. Its result preserves required-phase exit status.
Native desktop updates can occur outside `up`. Run the explicit inspect command after each native update.
A missing desktop is reported directly. The CLI installation is never substituted.

1. Inspect the explicit new installation and record its release identity and complete pristine tuple.
2. Run equivalent acceptance tests against pristine upstream. Retire any patch whose behaviour upstream supplies.
3. Add a separate release adapter and draft manifests for remaining patches. Resolve identifiers through actual lifecycle functions.
4. Add the release and adapter path to `RELEASE_ADAPTERS` in `scripts/bb_patch.py` before candidate preparation.
   Add its per-profile harness paths to `RELEASE_HARNESSES`.
   Retain admitted releases. Registry uniqueness and pristine consistency apply within each installation identity.
5. Prepare fresh scratch candidates. Run independent session-options, activity, combined, recovery and performance checks.
6. Review adapter, harness, intermediate and final fingerprints. Perform adversarial and simplification passes before offline approval.
7. Keep live application blocked until maintenance admission, updater exclusion and integrity controls are independently established.

The authoring source maps remain unchanged. They do not accurately map inserted code.
Never copy archived generated bundles into a new release or discover recipes from private backup archives.

Draft final tuples do not satisfy patch requirements. Draft recipes still permit preparation and offline verification from recognised pristine inputs.

## Disposable server rehearsal

The [Patches plugin](../patch-health/README.md) prepares and runs disposable server rehearsals.
`scripts/lab_candidate.py` binds offline results to package, Node, dependency and recipe fingerprints.
Its receipt admits only exact supported releases and both required patches.
Revalidation refuses changed inputs before starting a copied server.
The dependency fingerprint covers the installed mise distribution, including internal links and optional missing targets.

`scripts/patch_lab.py` stores a private journal in an owned, marked OS temporary directory.
It starts copied stock and candidate server entrypoints with separate HOME, data and loopback port.
It checks listener ownership before accepting health responses.
The fixture queries workflow activity through HTTP and checks terminal records after a cold restart.
It does not execute provider work or prove session-options delivery and notification behaviour.

```mermaid
stateDiagram-v2
  [*] --> created
  created --> preparing
  preparing --> ready
  ready --> rehearsing
  rehearsing --> checks_pending
  preparing --> blocked
  rehearsing --> blocked
  preparing --> interrupted
  rehearsing --> interrupted
  interrupted --> stopped: Stop only owned lab process
```

The detached worker survives a closed popover. Its journal supports explicit interruption recovery.
Recovery checks recorded PID, start signature and lab path before signalling.
Identity mismatches refuse signals. Recovery never escalates to forced termination or automatic restart.
A fresh rehearsal uses a fresh directory. Temporary evidence remains for inspection and system cleanup.
There is no live activation operation, launch-service change or deployment-pin change.
The runner does not establish production supervision or live maintenance admission.
