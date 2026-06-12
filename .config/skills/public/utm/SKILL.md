---
name: utm
description: Control UTM virtual machines on macOS programmatically — create and configure VMs via AppleScript, manage lifecycle with utmctl, run commands and transfer files in guests, and set up Windows 11 ARM for headless automation (SSH, not the guest agent). Use whenever the user mentions UTM, utmctl, VMs on Apple Silicon, creating/cloning/scripting a virtual machine on a Mac, or wants to run commands inside a local Windows or Linux VM — even if they don't name UTM explicitly.
---

# UTM VM Automation (macOS)

UTM wraps QEMU and Apple's Virtualization.framework. There are two automation
surfaces, and they are not equivalent:

- **`utmctl`** — bundled CLI. Lifecycle, guest exec/files/IP, clone, USB.
  It **cannot create, import, export, or configure** VMs.
- **AppleScript** (via `osascript`) — strict superset: everything utmctl does,
  plus creating VMs, editing hardware config, and keyboard/mouse input injection.

Rule of thumb: lifecycle and guest ops → `utmctl`; creation and configuration →
AppleScript. Both drive UTM.app over Apple Events (the app auto-launches; there
is no true daemon mode).

```bash
UTMCTL=/Applications/UTM.app/Contents/MacOS/utmctl   # not on PATH by default
```

## Task routing

| Task | Tool | Read |
|---|---|---|
| Start/stop/status/clone/delete, exec in guest, push/pull files, get IP, USB | `utmctl` | [references/utmctl.md](references/utmctl.md) |
| Create a VM, attach an ISO, change CPU/RAM/disk/network, port forwards, serial, input injection | AppleScript | [references/applescript.md](references/applescript.md) |
| Windows 11 on Apple Silicon: get the ISO, install, drivers, enable SSH/RDP, run PowerShell from the host | both | [references/windows.md](references/windows.md) |

## Everyday commands

```bash
$UTMCTL list                          # UUID / Status / Name
$UTMCTL start "MyVM"                  # name (exact) or UUID; resumes if suspended
$UTMCTL status "MyVM"
$UTMCTL stop "MyVM"                   # default is --force (power-off); --request asks guest
$UTMCTL clone "template" --name "worker-1"
$UTMCTL ip-address "MyVM" | head -1   # needs guest agent (see matrix below)
$UTMCTL exec "MyVM" --cmd uname --cmd -a            # needs guest agent
echo hi | $UTMCTL file push "MyVM" /tmp/hi          # stdin → guest file
$UTMCTL file pull "MyVM" /etc/hostname              # guest file → stdout
```

VMs are identified by UUID or **exact, complete name** — no partial matching.

## Guest agent support matrix — read before promising `exec`

`utmctl exec`, `file`, `ip-address` (and the AppleScript Guest Suite) require a
QEMU guest agent running *inside* the guest. Whether that's possible depends on
the guest/backend combination:

| Guest + backend | Agent works? | Automation path |
|---|---|---|
| Linux on QEMU | ✓ `apt/dnf/apk install qemu-guest-agent` | `utmctl exec` or SSH |
| Windows x86_64 on QEMU | ✓ via UTM guest tools ISO | `utmctl exec` or SSH |
| **Windows ARM64 on QEMU** (the normal case on Apple Silicon) | ✗ no native ARM64 agent ([utmapp/UTM#5134](https://github.com/utmapp/UTM/issues/5134), unfixed) | **SSH over a port forward** — see windows.md |
| Any guest on Apple VZ backend | unreliable; no input injection or USB either | SSH |

Prefer the **QEMU backend** when creating VMs for automation. For Windows ARM,
don't burn time trying to make the agent work — set up OpenSSH Server in the
guest and a host port forward; it's deterministic and survives reboots.

## Gotchas that waste hours

- **Automation (TCC) permission**: the first AppleScript/utmctl call from a new
  parent app (Terminal, an agent harness) triggers a macOS consent prompt, or
  fails with `-1743` if previously denied. Grant under System Settings →
  Privacy & Security → Automation → *calling app* → UTM. The grant is per
  calling binary; there's no supported headless pre-seed — trigger it once
  interactively.
- **Config is cached**: UTM reads each VM's `config.plist` once at app launch.
  Editing the plist on disk while UTM runs does nothing. Use AppleScript
  `update configuration` (VM must be stopped), or quit UTM → edit → relaunch.
- **Headless = no display device**: there's no headless flag. Remove the
  `displays` entry from the VM config (or omit it at creation) and use SSH or a
  serial port; `--hide` only hides the UTM window.
- **Clones share a MAC** → same DHCP lease/IP. After `clone`, blank the MAC via
  AppleScript so UTM regenerates it (snippet in applescript.md).
- **`delete` has no confirmation** and erases the VM's disks. Confirm with the
  user before deleting, and prefer `--disposable` starts (changes discarded on
  shutdown) for throwaway runs.
- **`ping` never works from guests** (libslirp limitation). Don't gate
  "is networking up" on ping; use a TCP check (`curl`, `Test-NetConnection`).
- **Generated AppleScript must be plain ASCII** — the `¬` line-continuation
  char breaks under some locales. Use single-line records or variables.

## Verifying an automation worked

`utmctl status` reflects the VM process, not guest readiness. After `start`,
poll for the thing you actually need: the SSH port accepting connections
(`nc -z localhost 2222`), the agent responding (`utmctl exec ... --cmd true`),
or `ip-address` returning a value. Boot can take 30–90s; poll with a timeout
rather than sleeping a fixed amount.
