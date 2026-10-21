# Command credentials

fnox loads command credentials from local encrypted values in
`~/.config/fnox/config.toml`. The MacBook Air's device-bound Secure Enclave identity
stays in `~/.config/fnox/age.txt`. The Mini uses a local age identity at the same path
for unattended decryption without Touch ID. Both files use mode `0600` and stay outside
Git. On the Mini, their directory uses mode `0700`.
The Air's independent recovery identity is stored in Bitwarden's `fnox recovery` note.
The Mini still needs a private off-machine backup of its identity and encrypted config.

New command credentials use fnox rather than exports in `.zshrc.local`.
Existing credentials stay in place until their consumers pass migration tests.
Keep application-managed OAuth sessions and SSH keys in their native stores.
The Air's fnox contains ElevenLabs, Brave, Exa, Typesafe, FreeAgent, fal and
Sprite Fusion. Context7, Gemini and xAI have no configured values in its shell file.
The Mini's fnox contains ElevenLabs. Brave, Context7, Exa, Gemini and xAI have
empty assignments in its shell file.

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

mise installs fnox and age. The Mini's local age identity requires no interactive
authentication. Processes that can read the identity can decrypt its credentials.
The Air uses a device-bound Secure Enclave identity instead.

After adding or replacing credentials, run `fnox reencrypt --provider age` to
consolidate their encryption.

The fnox memory cache is enabled with a 30-minute idle timeout. The Mini decrypts
without a prompt; later commands reuse cached credentials. Requests reset
the idle timer. After 30 minutes without requests, the daemon exits and drops
its cache. This is an inactivity timeout, not a fixed-duration approval grant.

Run `fnox daemon stop` to drop the cache immediately. Use `--no-daemon` to bypass
it for one command. Children retain inherited credentials for their lifetime,
even after cache expiry. Other processes running as your user can request
cached credentials.

On the Air, the restricted BB command sandbox blocks Secure Enclave access. Run fnox from
a normal terminal or use approved execution outside that sandbox. This setup
does not change sandbox policy.

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
private identity in Bitwarden rather than distributing it to workers.
Test Mac Mini authentication from the actual background job before enrolment.
Interactive authentication on the MacBook does not establish unattended access.

## Mac Mini enrolment

The shared mise configuration declares fnox, age and age-plugin-se. Tool versions
come from the committed mise lockfile. Each machine creates its credential files
locally; pulling dotfiles does not transfer credentials or private identities.

1. On the Mini, pull the reviewed dotfiles changes without discarding local edits.
   Install the three credential tools from the committed mise lockfile.
2. Test a disposable encrypted value from the actual background execution context.
   Try a Mini Secure Enclave identity without interactive authentication.
   Do not assume successful terminal decryption proves background access.
3. If Secure Enclave access fails unattended, use a local age identity with mode
   `0600`. Protect its directory with mode `0700`. This permits unattended use but
   does not protect credentials from processes with access to that identity.
4. Inventory `.zshrc.local` credentials without displaying values. Migrate only
   understood command credentials. Preserve shell functions, paths and unrelated
   settings. Leave native OAuth sessions and SSH identities in their own stores.
5. Verify exact value delivery in memory through `fnox exec`. Remove each old
   assignment only after its consumer passes. Restart consumers to clear inherited
   values. Report service validity separately from matching delivered values.
6. Back up the encrypted configuration and recovery material privately. Verify
   the backup before removing migration copies. Keep all credential files outside Git.

Use separate Mini service keys with restricted permissions and spending limits
where available. Until those exist, record any reused key names without values.
Only provide credentials to commands that need them; do not wrap every BB process
with the complete global credential configuration.

Nix owns shared tool and service configuration. Credential files are runtime
inputs, never Nix literals or files copied into the Nix store. Background service
changes require their own review and verification. Enrolment does not change
FileVault, login behaviour or reboot policy.

Paste this into an agent thread running on the Mini:

```text
Set up local encrypted fnox credentials on this Mac Mini.
Read ~/AGENTS.md and ~/docs/credentials.md first.
Check existing tools and configuration before changing anything.
Use the committed mise tool versions. Keep credentials and identities outside Git.

I authorise reading ~/.zshrc.local with a local value-redacting helper and editing
its credential assignments after successful migration. I authorise checking and
creating or updating ~/.config/fnox/ credential configuration, encrypted backups,
and the Mini's private identity. Use SECRETS_OK=1 only for these operations where
the credential guard requires it. Never print values, private identities or hashes.

Inventory credential names only. Do not source or execute .zshrc.local to discover
them. Preserve unrelated shell settings and stop on assignments you cannot safely
parse. Keep native OAuth sessions and SSH credentials unchanged.

Test unattended decryption with dummy data before migrating real credentials.
Try prompt-free Secure Enclave access from the actual background context first.
Use a private local age identity if that cannot work unattended. Do not copy the
Air's private identity or recover its private key from Bitwarden.

Migrate existing Mini command credentials without putting plaintext in temporary
files, command arguments, logs or chat. Compare delivered values only in memory.
Remove old assignments only after delivery and consumer checks pass. Do not make
billable API calls without asking. Explain any missing consumer checks.

Help me make and verify a private recovery backup. Configure a 30-minute idle
cache. Test repeated fnox launches and report the limits of cache expiry.
Do not reboot, log out, change FileVault, restart BB or change service configuration.
Report any background integration needed as a separate next step.
Commit only relevant non-secret dotfiles changes. Do not push.
```

## Recovery and rotation

Back up the encrypted `config.toml` privately after changing credentials.
The Air's Bitwarden recovery note contains its recovery identity, not its encrypted
credential file. Mini recovery requires its local age identity and encrypted config.
Back up both privately off the Mini.
`~/.config/fnox/config.toml.backup` is a local encrypted snapshot.
Keep an independent private copy off the Mac; the local snapshot does not cover
loss of the machine. Refresh both copies after changing credentials.

1. On the Air, keep the independent recovery identity in Bitwarden's `fnox recovery` note.
   Back up the device identity file too, but it cannot recover access on another
   Mac. Losing both the original Mac and the recovery identity prevents decryption.
2. To replace the API key, run `fnox set ELEVENLABS_API_KEY --provider age`.
   Enter the replacement at the hidden prompt. Do not pass it as an argument.
3. Run `fnox reencrypt --provider age` to consolidate the encrypted values.
4. Verify voice listing with `fnox exec`, then revoke the old key in ElevenLabs.
5. Update a private backup of the encrypted config. Keep it outside dotfiles.

For a second Mac, select the credentials it needs in a separate configuration.
Create a device identity and add its public recipient to that configuration's
age provider. Re-encrypt the selected credentials on an authorised machine
with `fnox reencrypt --provider age`. Adding a recipient alone does not update
existing ciphertext. Keep each private identity outside Git.

For Air recovery without an authorised Mac, restore the Bitwarden recovery identity
to `~/.config/fnox/age.txt` with mode `0600`. Restore the encrypted config too. This enables decryption of the local
config. Enrol a fresh device identity before removing the restored recovery file.
Retain the recovery public recipient in the config.

Removing a recipient cannot revoke its access to old ciphertext in backups.
Rotate the service credential when removing a machine's access.

Missing credentials stop command execution through `if_missing = "error"`.
Existing shells can retain an old exported value; clear it with
`unset ELEVENLABS_API_KEY`.
