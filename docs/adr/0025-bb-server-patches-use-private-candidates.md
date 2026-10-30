# BB server patches use private mise-backed candidates

User-service deployments select a private package through exact local mise pins.
The stock desktop uses a saved custom server URL. Its updates cannot replace the selected server package.
The existing Mini system-service configuration retains its deployment behaviour.

Package preparation tries exact transformations and behaviour harnesses on copied server files.
The version identifies the source without rejecting an unfamiliar release before verification.
Each failed feature retains stock files. Other features can still pass.
Patch failures remain advisory. Missing runtime files, native-module failures and copying errors block candidate selection.

The deployment configuration selects Node, the source BB version and the prepared package in one file.
The source pins preserve linked dependencies during mise pruning.
Content-addressed release paths keep running processes independent of later candidate selection.
Activation remains explicit and retains backup, idle and health checks.
Routine user activation refuses older releases and service-owner changes.

## Alternatives considered

- Manual warnings leave each native desktop update able to remove working server patches.
- Desktop-owned server reconciliation through `up` cannot cover native updates that bypass it.
- Disabling the packaged desktop updater requires changing integrity-hashed, signed `app.asar` without a supported off switch.
- A Nix-owned patched desktop adds distribution and signing work to a server-patch requirement.
- A browser-only client removes desktop update ownership but sacrifices native features without demonstrated need.

The stock desktop supports a saved server URL and leaves independent servers running on quit.
Native features and provider execution still require verification during live handover.
An older mise installation must not open data written by a newer desktop server without compatibility evidence.
