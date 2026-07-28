# ==============================================================================
# voxtap — system-audio capture helper for vox (desktop only)
# ==============================================================================
#
# Tiny Swift CLI (see ../voxtap/main.swift) that streams the system's audio
# output to stdout as 48 kHz mono float32, via a Core Audio process tap. `vox`
# reads it as a second ffmpeg input, so the other side of a call lands in the
# transcript with no audio routing to set up.
#
# Built here, not vendored or pulled from nixpkgs, for the same reason as
# biokc/imagepaste: the tap API (AudioHardwareCreateProcessTap, macOS 14.2+) is
# reachable only from the macOS SDK. We compile the committed source with the
# SYSTEM /usr/bin/swiftc (Command Line Tools) inside a nix derivation — nix
# orchestrates and pins the result into the store, but ships no Swift of its own.
# Relies on `sandbox = false` (set in nix.conf) so the builder can reach
# /usr/bin/swiftc and the SDK.
#
# The Info.plist is linked into __TEXT,__info_plist rather than living in a
# bundle: TCC reads the usage description from the Mach-O section for a plain
# executable, and vox needs a bare binary it can put on a pipe.
#
# Desktop-only: the headless server has neither audio nor the CLT.
{ pkgs, ... }:
let
  voxtap = pkgs.runCommandLocal "voxtap" { } ''
    mkdir -p $out/bin
    export SDKROOT="$(/usr/bin/xcrun --show-sdk-path 2>/dev/null || echo /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk)"
    /usr/bin/swiftc -O -o $out/bin/voxtap ${../voxtap/main.swift} \
      -framework AudioToolbox -framework CoreAudio \
      -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist \
      -Xlinker ${../voxtap/Info.plist}
    # Hardened runtime: belt-and-braces, strips get-task-allow.
    /usr/bin/codesign -s - -o runtime -f $out/bin/voxtap
  '';
in
{
  environment.systemPackages = [ voxtap ];
}
