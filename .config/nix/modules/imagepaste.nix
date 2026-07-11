# Native pasteboard reader that preserves original GIF bytes before falling
# back to PNG. Built with the system Swift toolchain because AppKit exposes the
# pasteboard representations that pngpaste flattens to a static image.
{ pkgs, ... }:
let
  imagepaste = pkgs.runCommandLocal "imagepaste" { } ''
    mkdir -p $out/bin
    export SDKROOT="$(/usr/bin/xcrun --show-sdk-path 2>/dev/null || echo /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk)"
    /usr/bin/swiftc -O -o $out/bin/imagepaste ${../imagepaste/main.swift} \
      -framework AppKit -framework UniformTypeIdentifiers
  '';
in
{
  environment.systemPackages = [ imagepaste ];
}
