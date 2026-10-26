# Workflows session options bundle patch

This exact-hash patch targets stock BB 0.47.1. It restores `agent()` session
options, provider validation, worker options, cache isolation and progress labels.
It reads stock records and historical records created by the 0.46.1 patch.
It preserves the Workflows plugin ID and origin ownership checks.

Only Workflows `server.js`, `app.js` and the authoring guide change.
The stock core hash identifies the supported installation. The patch neither
changes core nor requires the archived activity prototype.

```mermaid
flowchart LR
  Check[Pinned stock or patched hashes] --> Prepare[Prepare copied bundles]
  Prepare --> Verify[Syntax and synthetic behaviour tests]
  Verify --> Apply[Verify backups and replace bundles]
  Apply --> Reload[Reload after workflows finish]
```

## Check and prepare

Run from `~/src/bb-plugins/workflows-patch`.
`check` reads installed files. `prepare` writes only the selected output folder.
Both refuse unknown installation hashes. Exact stock and patched SHA-256 values
live in `EXPECTED` and `PATCHED` in [the script](scripts/patch-bundle.py).

```sh
python3 scripts/patch-bundle.py check
python3 scripts/patch-bundle.py prepare --output /private/tmp/bb-workflows-0471-review
node --check /private/tmp/bb-workflows-0471-review/builtin-plugins/workflows/dist/server.js
node --check /private/tmp/bb-workflows-0471-review/builtin-plugins/workflows/dist/app.js
python3 -m unittest discover -s scripts -p test_patch.py
node scripts/test-bundle.mjs /private/tmp/bb-workflows-0471-review/builtin-plugins/workflows/dist/server.js /private/tmp/bb-workflows-0471-test.mjs
```

The behaviour test resolves Zod and SDK imports from the adjacent
`workflow-timers` package. Workspace dependencies must already be installed.
Tests use synthetic records and disposable bundle copies. They do not access
BB's database, launch agents or reload plugins. Disposable test folders remain
under the system temporary directory for cleanup.

## Apply

1. Finish every active workflow. Do not apply or reload from a running workflow.
2. Complete the preparation checks above against the installed stock version.
3. Apply with a persistent backup folder, then check installed hashes.

   ```sh
   python3 scripts/patch-bundle.py apply
   python3 scripts/patch-bundle.py check
   ```

4. Reload Workflows after the workflow hosting this work has completed.

   ```sh
   bb plugin reload workflows
   ```

5. Reload the desktop window to load the progress view bundle.

The default preparation and backup root is
`~/.local/share/bb-bundle-patches/workflows-daybreak-0.47.1`.
`--output` changes both locations. Use the same folder when restoring.
Keep persistent backups outside `/private/tmp`.

Apply and restore verify every backup before replacing installed files.
Each replacement uses an atomic rename. Recoverable write failures roll back
completed replacements. A power loss can leave mixed pinned states; rerun
`check`, then `apply` or `restore` with the verified backup folder.
Concurrent app updates or patch operations are unsupported. Stop and inspect
any hash mismatch. Never force files across BB versions.

## Restore

Finish active workflows before restoring. Restore does not reload automatically.

```sh
python3 scripts/patch-bundle.py restore
python3 scripts/patch-bundle.py check
bb plugin reload workflows
```

Reload the desktop window after restoring. Restore accepts only verified stock
backups and pinned installed hashes. Core remains untouched.
Stock Workflows cannot preview historical records containing the restored fields;
restore reverses compatibility support without rewriting records.

## Compatibility

Missing options preserve stock cache keys. Explicit empty options keep their
previous patched cache identity. Boolean `false`, select values and fixed values
retain their meanings. Invalid IDs or values fail before worker spawn.
Stored labels remain readable without a live provider catalogue.
Both progress surfaces share the patched metadata builder.
There is no schema migration, historical record rewrite or database write.

An app update replaces bundle patches. Review a new exact-version patch after
an update; never copy these generated bundles over another BB release.
