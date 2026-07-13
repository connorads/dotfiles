# Windows 11 on UTM (Apple Silicon) — setup for automation

## Contents

- 1. Get the ISO
- 2. Create the VM (and the install-media trap)
  - The >4 GB ISO boot hang — read this first
  - The fix: repack the installer onto a FAT32 USB disk image (split WIM)
  - Hardware config
  - Boot order — avoid the reinstall loop
- 3. Install Windows — driving the GUI from the host
- 4. Enable SSH in the guest (admin PowerShell, once)
- 5. Reach the guest from the host
  - Shared networking (default NIC) — primary, faster
  - Emulated + port forward — deterministic fallback
  - Driving PowerShell over SSH — host-side gotchas
- 6. End-to-end automation loop
- Diagnostics & config editing
  - Inspect how QEMU actually launched (the DebugLog)
  - Editing config.plist (for what AppleScript can't set)
  - Clear a stale boot entry (NVRAM reset)

Goal: a Windows VM you can drive from the host (run PowerShell, copy files)
without touching the GUI. On Apple Silicon you run **Windows 11 ARM64** on the
QEMU backend. Official guide: <https://docs.getutm.app/guides/windows/>

**Two facts shape everything:**

1. There's no *native* ARM64 QEMU guest agent
   ([utmapp/UTM#5134](https://github.com/utmapp/UTM/issues/5134)), **but the UTM
   guest tools install the x64 `qemu-ga` which runs under Windows' x86 emulation
   and works** (verified as of guest-tools 0.1.271 / qemu-ga 109.1.0; newer
   builds expected to work). So
   `utmctl ip-address`, `utmctl file push/pull`, and the AppleScript
   `execute … with output capturing` all work. The one gap: **`utmctl exec` runs
   the command (exit 0) but returns no stdout** — use AppleScript `execute` (it
   captures) or SSH when you need output. For interactive/scriptable PowerShell,
   **OpenSSH Server** over the guest IP (shared networking) or a port forward is
   still the most ergonomic channel. Note the agent runs as `NT AUTHORITY\SYSTEM`.
2. **Windows 11 24H2 ISOs (~4.9 GB) will not boot from a normal attached ISO**
   on QEMU — they hang at the firmware "Start boot option" screen forever. You
   must repack the installer onto a FAT32 disk image (§2). This burns hours if
   you don't know it; it's the single biggest gotcha here.

## 1. Get the ISO

**CrystalFetch** (by the UTM author) builds official Win11 ARM64 ISOs from
Microsoft's servers: `brew install --cask crystalfetch` → choose ARM64 →
save e.g. `~/Downloads/Win11_ARM64.iso`. (GUI app; no CLI.)

The 24H2 build (26100) lands at **~4.9 GB** with a **multi-edition, solid**
`sources/install.wim` (Home / Home SL / Pro). Both properties matter in §2:
the size triggers the boot hang, and "solid" blocks a direct WIM split.

Alternative: Microsoft also publishes a prebuilt Win11 ARM64 **VHDX** (Insider /
ARM pages). Importing a VHDX skips the installer entirely and sidesteps the
boot-hang problem — worth suggesting if the user wants the fastest path and
doesn't care about a clean ISO install.

## 2. Create the VM (and the install-media trap)

### The >4 GB ISO boot hang — read this first

Attach a stock 24H2 ISO the normal way (a removable drive → UTM presents it as a
USB CD, `usb-storage … media=cdrom`) and the VM hangs at:

```text
BdsDxe: loading Boot0001 "UEFI QEMU QEMU USB HARDDRIVE 1-0000:00:03.0-4.1"
BdsDxe: starting Boot0001 ...
Start boot option              [full progress bar, never advances]
```

- The **"USB HARDDRIVE" label is cosmetic** — it's QEMU's `usb-storage` product
  string, shown even for `media=cdrom`. Don't chase it.
- Re-attaching the raw ISO as `media=disk` (a USB *hard disk*) doesn't help
  either — a stock Windows ISO is an El Torito optical image with no GPT/ESP, so
  the firmware finds nothing bootable: `failed to load … Not Found`.
- Most likely cause: EDK2 / `usb-storage` choke reading a **>4 GiB image over
  emulated USB mass-storage** (512-byte-block SCSI read-count overflow + very
  slow reads). Win11 24H2 is the first consumer image to routinely cross 4 GiB,
  which is why this surfaced in 2024–2025. The El Torito boot image itself is at
  a low offset and starts; the loaded Windows boot manager then stalls reading
  the oversized UDF payload.
  Refs: [QEMU #2893](https://gitlab.com/qemu-project/qemu/-/issues/2893),
  [UTM #5495](https://github.com/utmapp/UTM/issues/5495),
  [UTM discussion #6816](https://github.com/utmapp/UTM/discussions/6816),
  [dockur/windows #1548](https://github.com/dockur/windows/issues/1548).
- **This is independent of GUI vs scripting.** UTM's own Windows wizard attaches
  the ISO as a USB CD too, so the wizard hangs on a >4 GB 24H2 ISO the same way.
  The repack below is the fix either way.

### The fix: repack the installer onto a FAT32 USB disk image (split WIM)

Boot the installer as a **FAT32 USB hard disk with an EFI System Partition**
instead of a CD. This avoids the El Torito / >4 GiB CD path entirely. FAT32 caps
files at 4 GiB, so the 4.1 GB `install.wim` must be **split** into `.swm` parts
(Windows Setup reads split WIMs natively).

```bash
brew install wimlib                       # provides wimlib-imagex

# 1. Mount the ISO
hdiutil attach -readonly -nobrowse ~/Downloads/Win11_ARM64.iso   # -> /Volumes/<isoname>

# 2. install.wim is SOLID + multi-edition -> export ONE edition to a non-solid wim
#    (wimlib refuses to split a solid wim: "Export it in non-solid format first")
wimlib-imagex info  "/Volumes/<isoname>/sources/install.wim"      # list edition names
wimlib-imagex export "/Volumes/<isoname>/sources/install.wim" "Windows 11 Pro" \
    /tmp/install-pro.wim --compress=fast

# 3. Create a FAT32 disk image big enough for the contents (~8.5 GB for one edition)
hdiutil create -size 8500m -fs "MS-DOS FAT32" -volname WIN11 -layout MBRSPUD \
    -type UDIF /tmp/win11-usb.dmg
hdiutil attach -nobrowse /tmp/win11-usb.dmg                       # -> /Volumes/WIN11

# 4. Copy ISO contents (boot files FIRST so they sit at low offsets), minus install.wim
SRC=/Volumes/<isoname>; DST=/Volumes/WIN11
cp -R "$SRC/efi" "$SRC/boot" "$SRC/bootmgr.efi" "$SRC/setup.exe" "$DST/"
mkdir "$DST/sources"
rsync -a --exclude install.wim "$SRC/sources/" "$DST/sources/"
cp -R "$SRC/support" "$DST/"

# 5. Split the exported wim into <4 GiB parts INTO sources/
wimlib-imagex split /tmp/install-pro.wim "$DST/sources/install.swm" 3500
#    -> sources/install.swm + sources/install2.swm

ls "$DST/efi/boot/bootaa64.efi"          # sanity: the ARM64 UEFI bootloader is present
hdiutil detach "$DST"; hdiutil detach "$SRC"
```

Then attach `/tmp/win11-usb.dmg` to the VM as a **fixed (non-removable) USB
disk**. The drive `ImageType` (CD vs Disk) is **not exposed in UTM's AppleScript
dictionary**, so set it by editing `config.plist` (see §"Editing config.plist").
The drive record wants `ImageType=Disk`, `Interface=USB`, `ReadOnly=false`,
`removable=false`. Verify via the QEMU launch line (DebugLog) that it shows
`usb-storage,…,removable=false … media=disk`.

### Hardware config

Create the VM headless-but-with-a-display (the installer needs a screen). Use
**`virtio-ramfb-gl`** for the display, **NVMe** for the system disk:

```applescript
make new virtual machine with properties {backend:qemu, configuration:{name:"win11", architecture:"aarch64", memory:6144, cpu cores:4, drives:{{guest size:65536, interface:"NVMe"}}, displays:{{hardware:"virtio-ramfb-gl"}}}}
```

- **Display: use `virtio-ramfb-gl`, NOT `virtio-gpu-pci`.** Windows has no
  virtio-gpu driver during install, so `virtio-gpu-pci` goes black with
  **"Display output is not active"** the instant the Windows bootloader takes
  over. `virtio-ramfb` exposes a plain framebuffer that the Microsoft Basic
  Display Driver drives with zero drivers; the guest tools take over afterwards.
  `virtio-ramfb-gl` is what UTM's own Windows wizard picks (UTM v4.1+).
  (A *brief* "Display output is not active" during boot is normal; only a
  *persistent* one means the wrong adapter.)
- **System disk: NVMe.** Set `interface:"NVMe"` on the drive (shown inline
  above). A scripted drive otherwise defaults to VirtIO, which Windows Setup
  can't see without drivers; NVMe is visible out of the box.
- Then attach the FAT32 install image (above) and the guest-tools ISO
  (<https://getutm.app/downloads/utm-guest-tools-latest.iso>) as a removable CD.
- ≥4 cores, ≥6144 MiB RAM, ≥64 GiB disk (qcow2 is sparse — sizes to what Windows
  writes, ~27 GB for a fresh install).

### Boot order — avoid the reinstall loop

If the USB install disk has a lower `bootindex` than the NVMe system disk, the VM
boots back into the installer after Windows is laid down ("install Windows again?"
loop). Put **NVMe first** in the drive list, or simply **detach the install disk
after the copy phase completes**. The guest-tools CD can stay attached.

## 3. Install Windows — driving the GUI from the host

The installer needs GUI interaction. With Screen Recording permission you can
drive it entirely from the host via screenshots + input injection — see
[applescript.md](applescript.md) "Driving the installer". The loop:
capture the VM window → read the target → `input mouse click` / `input keystroke`.

OOBE notes for 24H2:

- **Local account is automatic when no network driver is loaded.** Before the
  guest tools install the VirtIO NIC, OOBE finds no network and skips the
  Microsoft-account requirement, dropping straight to "Who's going to use this
  device?" → local account. No `BYPASSNRO` / `start ms-cxh:localonly` needed.
  (If a NIC *is* present at OOBE, use `Shift+F10` → `start ms-cxh:localonly`.)
- "This PC can't run Windows 11" → `Shift+F10` → `regedit` →
  `HKLM\SYSTEM\Setup\LabConfig` → DWORDs `BypassTPMCheck=1`,
  `BypassSecureBootCheck=1`. (Recent UTM provides a TPM, so usually not needed.)
- On the disk-selection screen install to the **NVMe (~64 GB) disk**, not the
  ~8 GB FAT32 USB installer.
- After first desktop: run the guest tools from the **UTM CD** drive
  (`utm-guest-tools-*.exe /S` for silent). The display auto-resizes when its
  driver loads. Win11 24H2 black screen after tools install → eject the tools
  ISO, finish setup, re-mount + install tools, reset the VM.
- `ping` out of the guest never works (libslirp); test with
  `Test-NetConnection -Port 443 example.com`.
- Activation is your problem (licence), not UTM's.

## 4. Enable SSH in the guest (admin PowerShell, once)

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0   # slow: several minutes
Set-Service sshd -StartupType Automatic
Start-Service sshd

# Firewall rule is NOT reliably auto-created (esp. via the capability path).
# Microsoft's own docs use create-if-missing — treat this as mandatory, not a safety net:
if (!(Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -DisplayName "OpenSSH Server (sshd)" `
    -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
}

# Optional: make PowerShell the default ssh shell (nicer for automation; cmd.exe otherwise)
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
  -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force
```

Refs: [Win32-OpenSSH #900](https://github.com/PowerShell/Win32-OpenSSH/issues/900),
[MS Learn: OpenSSH firstuse](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse).

Deploy your host pubkey to **`C:\ProgramData\ssh\administrators_authorized_keys`**
(NOT `~/.ssh` — admins use the system file) and lock its ACL:

```powershell
Set-Content C:\ProgramData\ssh\administrators_authorized_keys '<your ssh-ed25519 key>'
icacls C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
```

## 5. Reach the guest from the host

Two paths. **Shared networking (direct IP) is faster and needs no port forward;
emulated + port forward is deterministic.** Prefer shared on the QEMU backend.

### Shared networking (default NIC) — primary, faster

The default `shared` (vmnet) NIC puts the guest on the macOS vmnet subnet
(typically `192.168.64.0/24`, host `.1`, guest `.2`), directly reachable:

```bash
ssh connor@192.168.64.2 'hostname'
```

Discover the guest IP from the host **without a guest agent** by reading the
vmnet DHCP leases (match the VM's MAC from its NIC settings — note the lease
file stores it as `1,a2:e1:...` with leading zeros stripped):

```bash
cat /var/db/dhcpd_leases     # name= / ip_address= / hw_address=1,<mac>
```

Caveat: the vmnet subnet can **drift** (`.64`→`.65`→… across reboots; Apple's
`com.apple.vmnet` is unreliable and UTM has no GUI to pin it), so re-check the
lease file if a session can't connect. Also: shared/vmnet works on the **QEMU
backend**; it's broken under the **Apple Virtualization** backend on Sequoia
([UTM #7472](https://github.com/utmapp/UTM/discussions/7472)).

A stable convenience alias (update HostName if the subnet drifts):

```sshconfig
Host win11
    HostName 192.168.64.2
    User connor
    IdentityFile ~/.ssh/id_ed25519
    StrictHostKeyChecking accept-new
```

### Emulated + port forward — deterministic fallback

Pin `127.0.0.1:2222 → 22` (never drifts, backend-independent). Switch the NIC to
`emulated` mode (slower than shared) and add the forward — AppleScript snippet in
[applescript.md](applescript.md):

```bash
ssh -p 2222 connor@127.0.0.1 'Get-ComputerInfo | Select OsName'
```

### Driving PowerShell over SSH — host-side gotchas

Hard-won driving a Win11 ARM guest headlessly (esp. for GUI apps):

- **The admin SSH session comes up elevated (high integrity).** Logging in via
  `administrators_authorized_keys` (sshd runs as SYSTEM) yields a full token —
  `whoami /priv` shows `SeBackupPrivilege Enabled` and installers self-elevate
  with no interactive UAC. So privileged headless ops just work: all-users MSIX
  installs, and reading the ACL-locked `C:\Program Files\WindowsApps\…` (use
  `robocopy /b` to lean on SeBackupPrivilege — plain copy is "Access is denied").

- **If DefaultShell is PowerShell (§4), send PowerShell *directly* — don't wrap it
  in `powershell -Command "…"`.** Nesting double-expands `$vars`: the outer shell
  expands `$PSVersionTable` / `$env:…` before the inner one sees it, yielding
  `System.Collections.Hashtable.…` garbage and parser errors. Just
  `ssh host '<powershell here>'`.

- **For anything with quotes, `scp` a `.ps1` and run it with `-File`.** The
  bash-single-quote → PowerShell quoting path is a tarpit (`\"x\"` leaks
  backslashes; PS parses the whole script before running, so one slip aborts
  everything with *no* partial output). `scp script.ps1 host:C:/tmp/x.ps1` then
  `ssh host 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\tmp\x.ps1'`.

- **GUI apps launched over SSH are invisible and die on disconnect.** SSH lands in
  a non-interactive session, not the console (session 1) the UTM window renders;
  the app never appears on screen, and OpenSSH tears down the session's process
  tree when the command returns. To launch a GUI app *into the logged-in console
  session* (visible + persistent), fire a one-shot scheduled task as the console
  user, then delete it:

  ```powershell
  $a = New-ScheduledTaskAction -Execute 'C:\path\App.exe' -Argument '--flag'
  $p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName run-once -Action $a -Principal $p -Force | Out-Null
  Start-ScheduledTask -TaskName run-once; Start-Sleep 5
  Unregister-ScheduledTask -TaskName run-once -Confirm:$false   # window stays open
  ```

## 6. End-to-end automation loop

```bash
UTMCTL=/Applications/UTM.app/Contents/MacOS/utmctl
$UTMCTL start "win11"
until nc -z -G 3 192.168.64.2 22; do sleep 5; done    # wait for boot + sshd (shared IP)
ssh win11 'powershell -Command "& C:/temp/payload.ps1"'
$UTMCTL stop "win11" --request                         # graceful; --force to power off
```

For richer GUI control enable RDP and forward/route 3389 the same way. For fully
unattended *installs* (no GUI step), bake an `autounattend.xml` and use
packer-plugin-utm (<https://github.com/naveenrajm7/packer-plugin-utm>) — suggest it
when the user wants reproducible image builds rather than a one-off VM.

## Diagnostics & config editing

### Inspect how QEMU actually launched (the DebugLog)

When a VM misbehaves at the firmware/boot level, see the exact QEMU command line
(how each drive is presented — `media=cdrom` vs `media=disk`, `removable=`,
`bootindex`, display device). Enable it, start the VM, read `Data/debug.log`:

```bash
P=~/Library/Containers/com.utmapp.UTM/Data/Documents/<name>.utm/config.plist
plutil -replace QEMU.DebugLog -bool true "$P"          # effective next launch
# ... start VM ...
cat ~/Library/Containers/com.utmapp.UTM/Data/Documents/<name>.utm/Data/debug.log
plutil -replace QEMU.DebugLog -bool false "$P"         # turn off when done
```

This is the fastest way to confirm a drive is attached the way you intended.

### Editing config.plist (for what AppleScript can't set)

Drive `ImageType` (CD vs Disk) and a few other fields aren't in the scripting
dictionary. Edit the plist directly — but **UTM caches each config at launch**,
so **quit UTM first**, edit, relaunch:

```bash
osascript -e 'tell application "UTM" to quit'; sleep 3
python3 - <<'EOF'
import plistlib, pathlib
p = pathlib.Path.home()/"Library/Containers/com.utmapp.UTM/Data/Documents/win11.utm/config.plist"
d = plistlib.loads(p.read_bytes())
# e.g. order drives NVMe-first, flip an ISO drive to a fixed USB disk, etc.
print([(x["Interface"], x.get("ImageName","CD"), x.get("ImageType")) for x in d["Drive"]])
p.write_bytes(plistlib.dumps(d))
EOF
```

Removable-media *source paths* are stored in UTM's prefs
(`…/Data/Library/Preferences/com.utmapp.UTM.plist`), keyed by the drive's
`Identifier` — handy to confirm which ISO is actually inserted.

### Clear a stale boot entry (NVRAM reset)

The firmware remembers boot entries in `Data/efi_vars.fd`. After fixing a drive
that previously failed to boot, delete it so EDK2 re-enumerates cleanly:

```bash
rm -f ~/Library/Containers/com.utmapp.UTM/Data/Documents/<name>.utm/Data/efi_vars.fd
```
