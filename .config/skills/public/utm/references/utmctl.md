# utmctl reference (UTM 4.7.x)

Binary: `/Applications/UTM.app/Contents/MacOS/utmctl`. Thin client over the
AppleScript bridge — drives a running UTM.app and launches it if needed.

Global flags on every VM-targeting subcommand: `-d/--debug`, `--hide` (hide the
UTM window — cosmetic only, not headless).

`<identifier>` = VM UUID or the exact, complete VM name.

| Subcommand | Usage | Notes |
|---|---|---|
| `version` | `utmctl version` | App version |
| `list` | `utmctl list` | Columns: `UUID Status Name` |
| `status` | `utmctl status <id>` | `stopped/starting/started/pausing/paused/resuming/stopping` |
| `start` | `utmctl start <id> [--attach] [--disposable] [--recovery]` | `--attach` = attach first serial port; `--disposable` = run as snapshot, discard disk changes; resumes suspended VMs |
| `suspend` | `utmctl suspend <id> [--save-state]` | Without `--save-state`, state is memory-only |
| `stop` | `utmctl stop <id> [--force\|--kill\|--request]` | Default **--force** (power-off event). `--request` asks the guest (may be ignored); `--kill` kills the backend process |
| `attach` | `utmctl attach <id> [--index <n>]` | Redirect serial port to this terminal |
| `exec` | `utmctl exec <id> [--input] [--env N=V ...] --cmd <c> [--cmd <arg> ...]` | Requires guest agent. Repeat `--cmd` per argv element. `--input` forwards stdin |
| `ip-address` | `utmctl ip-address <id>` | Requires guest agent. IPv4 lines before IPv6 |
| `clone` | `utmctl clone <id> [--name <name>]` | Then randomise the MAC (applescript.md) |
| `delete` | `utmctl delete <id>` | **No confirmation. Destroys disks.** |
| `file pull` | `utmctl file pull <id> <guest-path>` | Guest file → stdout. Requires guest agent |
| `file push` | `utmctl file push <id> <guest-path>` | stdin → guest file. Requires guest agent |
| `usb list` | `utmctl usb list` | Only useful while a USB-sharing VM runs |
| `usb connect` | `utmctl usb connect <id> <device>` | VM must be running |
| `usb disconnect` | `utmctl usb disconnect <device>` | `<device>` = `VID:PID` or location index; takes no `<identifier>` |

## Caveats

- **Nested help is broken**: `utmctl help file pull` and `utmctl file pull --help`
  print the top-level help. Run the subcommand with no args — the usage-error
  line shows the real signature.
- `exec` argv quoting: each `--cmd` is one argv element, e.g.
  `--cmd /bin/sh --cmd -c --cmd 'echo $HOME'`.
- `start --disposable` ↔ AppleScript `start ... saving:false`.
- No create/import/export/configure — AppleScript only.

## Wait-for-boot pattern

```bash
UTMCTL=/Applications/UTM.app/Contents/MacOS/utmctl
$UTMCTL start "MyVM"
for i in $(seq 1 60); do
  IP=$($UTMCTL ip-address "MyVM" 2>/dev/null | head -1) && [ -n "$IP" ] && break
  sleep 3
done
ssh "user@$IP" 'uname -a'
```

For guests without an agent (Windows ARM), poll the forwarded SSH port instead:
`until nc -z 127.0.0.1 2222; do sleep 3; done`.
