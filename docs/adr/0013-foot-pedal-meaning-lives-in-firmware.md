# The foot pedal's meaning lives in its firmware

A PCsensor 3-pedal USB foot switch (`3553:b001`) drives hands-occupied prompting
of Claude Code in kitty + tmux. The pedal's firmware emits the keys itself: left
is Escape, centre is right Option held for as long as the pedal is down, right is
Enter. Nothing runs on the Mac to interpret the pedal. `pedal-flash` writes that
map with the nix-built `footswitch` and verifies it by readback.

## Context

Centre is hold-to-talk into MacWhisper, whose dictation is already bound to right
Option (Parakeet v3, USB Audio CODEC as default input). MacWhisper's hotkey is a
single enum - `rightOption | function | custom | none` - so the pedal and the
keyboard can share one trigger only by emitting the same key. The pedal emits the
modifier bits alone (`-m r_alt`, HID modifier bit 0x40, readback `r_alt`) with no
key in the key slot; the firmware holds that report for as long as the pedal is
down, macOS reads it as a held right Option, and MacWhisper's trigger fires from
it (verified by dictating into a Claude Code prompt). Release inserts text only;
the right pedal sends.

## Decision

Firmware holds the whole map. `footswitch` is packaged from a pinned rev
(`packages/footswitch.nix`); `pedal-flash` is the one command that writes it.
Middleware is a named future layer, not a day-one dependency: Karabiner
`device_if` on `3553:b001` can override the pedal per app without touching the
keyboard, and only a counted need (keyboard reaches, corrections, accidental
presses in a real session) justifies building it.

## Alternatives considered

**ericfitz's Footswitch app.** Its `PedalListener.swift` (line 32) masks
`keyDown` only, and `LiveEventPoster.swift` (lines 8-14) posts a synthetic
down+up pair per press, so hold-to-talk is impossible: the pedal can only tap.
PolyForm Noncommercial licence, distributed as a DMG with no cask.

**nixpkgs' `footswitch`.** `meta.platforms = lib.platforms.linux` (it uses
`udevCheckHook`), so it refuses to evaluate on darwin. Its `1.0-unstable-2023-10-10`
snapshot also predates upstream PR #106 (2026-06-24), which opens HID interface 1
explicitly; this pedal is a composite device whose interface 0 is the keyboard
macOS refuses to open, and the older `hid_open(vid,pid)` path fails on macOS
depending on enumeration order.

**MacWhisper Custom hotkey = F13 on the pedal.** The single-trigger enum means
Custom replaces right Option, retiring the keyboard's dictation key. Emitting
right Option from the pedal keeps both.

**Karabiner-Elements from day one.** `karabiner.json` is not declarative under
nix-darwin: `services.karabiner-elements` exposes only `enable` and `package`, so
the mapping would live in an untracked file. There is no day-one need it would
meet that firmware does not.

**Hammerspoon.** Not in nixpkgs (nix-darwin#844 open); would add an untracked
runtime for a three-key map.

**Pedal driving `vox` inside tmux.** `vox` is toggle-only and tmux-scoped, so it
cannot hold-to-talk and cannot dictate into a native app. Parked with tmux pane
targeting.

**MacWhisper toggle mode.** Named as the last resort if hold-to-talk failed; hold
worked in the firmware test (macOS key-repeat fired while the pedal was down), so
it was never needed.

## What was audited before flashing

The flashed binary is `rgerganov/footswitch@454e00b`, built from the pinned hash
`sha256-/AyHJK7N3sGpI8iNWALVT4sxqiK4dFPkp9KhZ8j+xY0=`. Full read of `src/common.c`,
`src/debug.c`, `src/footswitch.c`, `include/*.h`, Makefile and CMakeLists: zero
matches for socket/connect/system/popen/exec/fork/posix_spawn/fopen/open/getenv/
dlopen/ioctl; the only non-trivial libc is `sscanf`/`atoi` on `optarg`. Every write
is an 8-byte `hid_write`; `-k` puts a table keycode in byte 3, `-m` ORs bits into
byte 2, `-r` sends `01 82 08 <n>` and reads 8 bytes. All argv-fed buffers are
length-checked. Device open is constrained to five hard-coded VID:PID pairs; no
argv or env reaches a path. PR #106 is a 12-line diff (interface selection plus
fallback), read in full. Provenance: repo since 2012, MIT, maintainer authored
most recent commits, CI on Ubuntu and macOS. Assumed trustworthy: nixpkgs
`hidapi` and the clang stdenv. Out of scope: the pedal's own firmware, for which
readback is the only check. Weak counter-evidence: the four other VID:PID pairs
are tried first, so a `0c45:7403/7404`, `413d:2107` or `1a86:e026` device on the
bus would be flashed instead; `pedal-flash` verifies by readback regardless.

## Known limits

MacWhisper's preferences (the right Option binding, push-to-talk mode, the input
device) are untracked application state. If they drift, the pedal still emits
right Option and nothing in this repo says why dictation stopped.

Readback proves only what the firmware holds; that macOS and MacWhisper honour
the modifier-only report was checked by pressing the pedal. Fallbacks if a macOS
or MacWhisper change ever breaks that: `-2 -k Meta_R` (keycode 0xe6 in the key slot; lower odds, a Scythe II
ignored `Shift_L` that way in upstream issue #78), then Karabiner mapping a pedal
F13 to `right_option`.
