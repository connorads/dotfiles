# UTM AppleScript API (UTM.sdef, UTM 4.7.x)

Run via `osascript script.applescript` or `osascript -e '...'`. Full dictionary:
Script Editor → File → Open Dictionary → UTM, or
`/Applications/UTM.app/Contents/Resources/UTM.sdef`.
Docs: https://docs.getutm.app/scripting/

**Use AppleScript, not JXA, for creation/config** — JXA `make` with a
configuration record fails with type-conversion errors (known, unresolved).
JXA is fine for read-only queries. Emit plain ASCII (no `¬`).

## Object model

- App element `virtual machine` (r/o list). VM properties (all r/o): `id`
  (UUID text), `name`, `backend` (`apple`/`qemu`), `status` (`stopped`,
  `starting`, `started`, `pausing`, `paused`, `resuming`, `stopping`).
- VM elements: `serial port` (`id`, `interface` ptty/tcp, `address`, `port`).
- VM property `configuration` — a `qemu configuration` or `apple configuration`
  record; writable only via `update configuration` while the VM is **stopped**;
  the backend can never change after creation.

## Lifecycle commands

```applescript
tell application "UTM"
  set vm to virtual machine named "MyVM"   -- or: virtual machine id "UUID"
  start vm                       -- start vm saving false  = disposable
  suspend vm saving true         -- save state to disk
  stop vm                        -- stop vm by request | by force | by kill
  duplicate vm with properties {configuration:{name:"copy"}}
  delete vm                      -- no confirmation
  import new virtual machine from POSIX file "/path/My.utm"
  export vm to POSIX file "/path/out.utm"
end tell
```

## Creating VMs

`make new virtual machine` needs `backend` + a `configuration` containing at
least `name`; QEMU also requires `architecture` (`aarch64`, `x86_64`).
Memory and disk sizes are **MiB**. A drive record with empty `id` and a
`guest size` creates a new disk; `removable:true` + `source` attaches an ISO.

```applescript
tell application "UTM"
  set iso to POSIX file "/Users/me/Downloads/ubuntu-24.04-arm64.iso"
  set vm to make new virtual machine with properties { ¬
    backend:qemu, configuration:{ ¬
      name:"ubuntu-arm", architecture:"aarch64", memory:8192, cpu cores:4, ¬
      drives:{{removable:true, source:iso}, {guest size:65536}}}}
end tell
```

(Shown wrapped for readability — emit it as a single line in generated code.)

New-QEMU-VM defaults: **no display** (headless), one PTTY serial port, one
`shared` network. Add a display only if the user needs a GUI:
`displays:{{hardware:"virtio-gpu-pci"}}` (aarch64) / `"virtio-vga-gl"` (x86_64).

Apple backend (`backend:apple`): same shape, no `architecture`/`uefi`/
`hypervisor`; network modes only `shared`/`bridged`; serial only ptty; no input
injection or USB. Prefer QEMU for automation.

## qemu configuration record (key properties)

`name`, `notes`, `architecture`*, `machine` (empty = default), `memory` (MiB),
`cpu cores` (0 = host default), `hypervisor`, `uefi`,
`directory share mode` (`none`/`WebDAV`/`VirtFS`),
`drives`, `network interfaces`, `serial ports`, `displays`,
`qemu additional arguments`.

- **drive**: `id` (empty = create), `removable` (fixed at creation),
  `interface` (`VirtIO`, `NVMe`, `USB`, `IDE`, ...; empty = sensible default),
  `guest size` (MiB, new disks), `raw` (bool, new disks), `source` (file).
- **network interface**: `index` (empty = append), `mode` (`emulated`/`shared`/
  `host`/`bridged`), `address` (MAC; **empty string = regenerate**),
  `host interface` (bridged), `port forwards` (**emulated mode only**) —
  list of `{protocol:TCP, host port:2222, guest port:22}` (+ optional
  `host address`/`guest address`).
- **serial port**: `index`, `interface` (`ptty`/`tcp`), `port` (tcp listen port).
- **display**: `hardware` (required), `dynamic resolution` (bool).

## Recipes

**Attach/replace an ISO on an existing VM** (stopped):

```applescript
tell application "UTM"
  set vm to virtual machine named "MyVM"
  set config to configuration of vm
  set i to id of item 1 of drives of config
  set item 1 of drives of config to {id:i, source:POSIX file "/path/new.iso"}
  update configuration of vm with config
end tell
```

**Randomise MAC after cloning** (clones inherit the MAC → duplicate DHCP IPs):

```applescript
tell application "UTM"
  set vm to virtual machine named "worker-1"
  set config to configuration of vm
  set item 1 of network interfaces of config to {address:""}
  update configuration of vm with config
end tell
```

**SSH port forward** (needed for guests without an agent, e.g. Windows ARM —
note this requires switching the NIC to `emulated` mode):

```applescript
set item 1 of network interfaces of config to {mode:emulated, port forwards:{{protocol:TCP, host address:"127.0.0.1", host port:2222, guest port:22}}}
update configuration of vm with config
```

**Scriptable serial console** (expect/nc automation; ptty is unreliable):
`serial ports:{{interface:tcp, port:4444}}` then `nc localhost 4444`.

## Guest Suite (QEMU guest agent required)

```applescript
tell application "UTM"
  set vm to virtual machine named "linux"
  query ip vm                                    -- list, IPv4 first
  set p to execute vm at "/usr/bin/uname" with arguments {"-a"} with output capturing
  delay 1
  get result p   -- record: exited, exit code, output text, error text
end tell
```

Guest files: `open file vm at "/tmp/x" for writing` → then `write`/`push`/
`pull`/`read`/`close` on the returned `guest file` (48 MB read limit).

## Input injection (QEMU backend only — no agent needed)

Last-resort UI automation (e.g. clicking through an installer):

```applescript
input keystroke vm text "hello" with modifiers {shift}
input mouse click vm at {400, 300} with mouse button left
input scan code vm codes {28}    -- raw PC AT scan codes (28 = Enter)
```

## After `update configuration`

Device `index` fields are invalidated — re-read the configuration before a
second update. Raw `config.plist` edits require quitting UTM first (the app
caches configs at launch); files live under
`~/Library/Containers/com.utmapp.UTM/Data/Documents/<name>.utm/`. UEFI NVRAM
(`efi_vars.fd`) is ephemeral — install bootloaders to the removable path
(`grub-install --removable`) rather than relying on efibootmgr entries.
