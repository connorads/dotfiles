# Windows 11 on UTM (Apple Silicon) — setup for automation

Goal: a Windows VM you can drive from the host (run PowerShell, copy files)
without touching the GUI. On Apple Silicon you run **Windows 11 ARM64** on the
QEMU backend. Official guide: https://docs.getutm.app/guides/windows/

**The one fact that shapes everything**: there is no native ARM64 QEMU guest
agent for Windows ([utmapp/UTM#5134](https://github.com/utmapp/UTM/issues/5134)),
so `utmctl exec / file / ip-address` **do not work** on Windows ARM guests.
The reliable host→guest channel is **OpenSSH Server + a port forward**.
(Running the x64 qemu-ga under emulation is reported as a workaround but
unconfirmed — don't rely on it.)

## 1. Get the ISO

**CrystalFetch** (by the UTM author) builds official Win11 ARM64 ISOs from
Microsoft's servers: `brew install --cask crystalfetch` → choose ARM64 →
save e.g. `~/Downloads/Win11_ARM64.iso`. (GUI app; no CLI. The alternative is
downloading a VHDX from Microsoft's Insider/ARM pages.)

## 2. Create the VM

Easiest reliable path: UTM GUI wizard — Virtualize → Windows → tick
**"Install Windows 10 or higher"** and **"Install drivers and SPICE tools"**
→ pick the ISO. The wizard auto-mounts the guest-tools ISO as a second CD so
VirtIO drivers install during setup. Recommended: ≥4 cores, 8192 MiB RAM,
≥64 GiB disk.

Scripted creation (AppleScript) works too — see applescript.md — but you must
attach the guest-tools ISO yourself
(https://getutm.app/downloads/utm-guest-tools-latest.iso) as a second
removable drive, and add a display (`displays:{{hardware:"virtio-gpu-pci"}}`)
because scripted VMs default to headless and the Windows installer needs a
screen.

## 3. Install Windows (interactive bits)

The installer needs GUI interaction once; known bumps:

- "This PC can't run Windows 11" → installer console (`Shift+F10`):
  regedit → `HKLM\SYSTEM\Setup\LabConfig` → DWORDs `BypassTPMCheck=1`,
  `BypassSecureBootCheck=1` (recent UTM enables TPM, usually not needed).
- Network not detected during OOBE (VirtIO driver not loaded yet) →
  `Shift+F10` → `OOBE\BYPASSNRO`, or on newer builds `start ms-cxh:localonly`
  to create a local account.
- After install: run the guest tools installer from the mounted "UTM" CD
  (`spice-guest-tools-*.exe`) — networking and dynamic display depend on it.
- Win11 24H2 black screen after tools install → eject guest-tools ISO,
  finish Windows setup, re-mount and install tools, reset VM.
- Activation is your problem (licence), not UTM's.
- `ping` out of the guest never works (libslirp); test connectivity with
  `Test-NetConnection -Port 443 example.com` instead.

## 4. Enable SSH in the guest (in an admin PowerShell, once)

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Set-Service sshd -StartupType Automatic
Start-Service sshd
# make PowerShell the default ssh shell (optional but nicer for automation)
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
  -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force
```

## 5. Port-forward host→guest

The guest agent can't report the IP, so don't chase it — pin a forward instead.
Switch the NIC to `emulated` mode with a TCP forward 127.0.0.1:2222 → 22
(AppleScript snippet in applescript.md; or UTM settings → Network → Emulated
VLAN → Port Forward). Then:

```bash
ssh -p 2222 user@127.0.0.1 'Get-ComputerInfo | Select-Object OsName'
scp -P 2222 ./payload.ps1 user@127.0.0.1:'C:/temp/'
```

Trade-off: `emulated` networking is slower than `shared` (vmnet). Alternative
that keeps `shared` mode: find the guest IP from the host's ARP/DHCP tables
(`arp -a` after boot) — works, but is less deterministic than a pinned port.

## 6. End-to-end automation loop

```bash
UTMCTL=/Applications/UTM.app/Contents/MacOS/utmctl
$UTMCTL start "win11"
until nc -z 127.0.0.1 2222; do sleep 5; done        # wait for boot + sshd
ssh -p 2222 user@127.0.0.1 'powershell -Command "& C:/temp/payload.ps1"'
$UTMCTL stop "win11" --request                       # graceful; falls back: --force
```

For richer control (GUI tests, screenshots) enable Remote Desktop in the guest
and forward 3389 the same way. For fully unattended Windows *installs* (no GUI
step at all), bake an `autounattend.xml` ISO — packer-plugin-utm
(https://github.com/naveenrajm7/packer-plugin-utm) is the mature route; suggest
it when the user wants reproducible image builds rather than a one-off VM.
