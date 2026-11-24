# BB deployment snapshots data with APFS clones

Activation stops the BB service, clones `~/.bb` into `~/.local/state/bb-deploy/snapshots/` with `cp -c`, promotes the candidate pins and starts the service.
A clone shares blocks with its source. It takes no space when created, and grows only as BB rewrites data after the restart.
The snapshot must share a volume with `~/.bb`; otherwise activation defers before stopping BB.
A stop or snapshot failure restarts the deployed release with unchanged pins.

The snapshot is an upgrade rollback copy on the same disk. It gives no protection against disk loss.
Delete it after the new release has run correctly; its space use grows with every rewritten block.

## Alternatives considered

- **BB server export.** The server copies the whole database into `~/.bb/server-export`, builds a gzip archive there, then sends it. A 19.3 GB database exceeded the five-minute request limit, and the export needed about 20 GB on an internal disk with 25 GB free. Disk exhaustion had already crashed the host daemon with `ENOSPC`.
- **Export to an encrypted external volume.** The server builds the export on the internal disk wherever the client writes the archive, so the space risk remains. Encrypting the volume also adds a boot-unlock dependency for `~/git`.
- **Export encrypted with `age`.** Same internal-disk requirement as the export, plus a private key that must stay recoverable.
- **Clone while BB runs.** The database and its write-ahead log are cloned at different instants, so the copy can be inconsistent.
- **No backup.** A failed database migration in the new release would have no rollback.
