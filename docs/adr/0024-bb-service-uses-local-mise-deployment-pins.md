# The BB system service uses local mise deployment pins

The Mini's Nix daemon resolves BB and Node from a local mise configuration containing exact versions.
Git synchronises desired versions. Deployment selects installed versions only after native-module verification.
Startup requires no installation. BB's in-app updater is disabled for declarative server launchers.

A shared lock can select a version absent on another machine after a pull.
Launchd retries cannot repair a missing installation. The deployed selection must remain independent of that lock.

Mise tracks current, candidate and previous configurations for pruning retention.
Activation checks running tasks, exports a backup, checks tasks again and atomically promotes the candidate configuration.
The command checks HTTP health, application version and the primary execution daemon after restart.
An idle check reduces interruption risk but cannot prevent new task admission.
Activation is explicit because BB exposes no verified general drain operation.

## Alternatives considered

- **Install after every pull.** A failed or omitted installation still leaves the daemon selecting an absent version at its next start.
- **Custom JSON deployment registry.** Exact path records require separate pruning protection. Local mise pins already provide resolution and retention.
- **Complete Nix package.** BB's native SQLite, PTY and watcher dependencies require an additional packaging workflow. The demonstrated failure concerns release selection.
- **BB-managed updates.** BB can select releases outside mise. Its updater documents no automatic rollback, and migrations can prevent older releases opening updated data.
- **Periodic idle deployment.** The running-thread API does not block new work. A scheduler adds pending-state management without guaranteeing interruption-free deployment.

Executable retention does not establish database rollback compatibility. Recovery requires a verified backup and a compatible executable.
