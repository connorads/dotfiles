# Command credentials

fnox loads command credentials from local encrypted values in
`~/.config/fnox/config.toml`. Keep encrypted values and private identities outside Git.
See the private machine runbook for device enrolment and recovery details.

New command credentials use fnox rather than exports in `.zshrc.local`.
Existing credentials stay in place until their consumers pass migration tests.
Keep application-managed OAuth sessions and SSH keys in their native stores.

Use `fnox exec -- <command>` to decrypt credentials into a command's environment.
The command and its children can read their credentials. Direct injection adds
no proxy size limit and does not buffer media streams.
Select only the credentials each command needs. `fnox exec` loads all eligible
secrets from the active configuration.

## Launching consumers

Prefix commands that need credentials with `fnox exec --`:

```sh
fnox exec -- pi
fnox exec -- opencode
fnox exec -- python3 path/to/script.py
```

The selected command receives every credential in the current global config.
These prefixes are explicit; ordinary launches do not load fnox automatically.
Restart existing consumers and shells after removing plaintext exports.
Existing processes keep their inherited credentials until they exit.

Migration checks verify exact delivery with inherited credential variables removed.
A non-billable ElevenLabs voice-listing request verifies API access. Speech
generation requires a separate billable check.

## Device authentication

mise installs fnox and age. Choose a device-bound identity for interactive use.
Test identity access from the background job before enrolment.

After adding or replacing credentials, run `fnox reencrypt --provider age` to
consolidate their encryption.

The fnox memory cache is enabled with a 30-minute idle timeout. Commands can reuse cached credentials. Requests reset
the idle timer. After 30 minutes without requests, the daemon exits and drops
its cache. This is an inactivity timeout, not a fixed-duration approval grant.

Run `fnox daemon stop` to drop the cache immediately. Use `--no-daemon` to bypass
it for one command. Children retain inherited credentials for their lifetime,
even after cache expiry. Other processes running as your user can request
cached credentials.

## ElevenLabs

Use direct injection for voice listing and speech generation:

```sh
fnox exec -- elevenlabs voices get_all
fnox exec -- elevenlabs say "Hello" --output /tmp/hello.mp3
```

Speech generation consumes ElevenLabs credits. Direct injection does not isolate
an agent from files or other processes running as your user.

## Additional services and machines

Test each consumer with dummy credentials before moving its real credential.
Verify credential selection, stale inherited variables, failure behaviour and
the client's actual transport. Remove an old export after its consumers pass.

Use separate configurations for workloads that need different credentials.
An explicit config path alone does not exclude the global configuration.
Set `FNOX_CONFIG_DIR` to an isolated directory and test the resulting selection.
This does not remove unrelated credentials inherited from the parent environment.
Clear inherited credential variables before starting a restricted workload.

Give each Mac its own identity. Give unattended workloads only their required
credentials, using separate service keys where available. Keep the recovery
private identity in a password manager rather than distributing it to workers.

Nix owns shared tool and service configuration. Credential files are runtime
inputs, never Nix literals or files copied into the Nix store. Background service
changes require their own review and verification. Enrolment does not change
FileVault, login behaviour or reboot policy.

## Recovery and rotation

Back up the encrypted `config.toml` privately after changing credentials.
`~/.config/fnox/config.toml.backup` is a local encrypted snapshot.
Keep an independent private copy off the Mac; the local snapshot does not cover
loss of the machine. Refresh both copies after changing credentials.

1. Run `fnox set ELEVENLABS_API_KEY --provider age`. Enter the replacement at the hidden prompt.
2. Run `fnox reencrypt --provider age` to consolidate the encrypted values.
3. Verify voice listing with `fnox exec`, then revoke the old key in ElevenLabs.
4. Update a private backup of the encrypted config. Keep it outside dotfiles.

For a second Mac, select the credentials it needs in a separate configuration.
Create a device identity and add its public recipient to that configuration's
age provider. Re-encrypt the selected credentials on an authorised machine
with `fnox reencrypt --provider age`. Adding a recipient alone does not update
existing ciphertext. Keep each private identity outside Git.

Removing a recipient cannot revoke its access to old ciphertext in backups.
Rotate the service credential when removing a machine's access.

Missing credentials stop command execution through `if_missing = "error"`.
Existing shells can retain an old exported value; clear it with
`unset ELEVENLABS_API_KEY`.
