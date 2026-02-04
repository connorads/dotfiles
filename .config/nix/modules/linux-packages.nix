# ==============================================================================
# Linux Packages Configuration
# ==============================================================================
# Full package set for Linux workstations with VS Code override
{ pkgs, packages, ... }:
let
  # VS Code override: nixpkgs often lags the latest release.
  # Update version/rev/hashes when a new release is needed.
  vscodeOverride = pkgs.vscode.overrideAttrs (
    _old:
    let
      version = "1.108.1";
      rev = "585eba7c0c34fd6b30faac7c62a42050bfbc0086";
    in
    {
      inherit version rev;
      src = pkgs.fetchurl {
        name = "VSCode_${version}_linux-x64.tar.gz";
        url = "https://update.code.visualstudio.com/${version}/linux-x64/stable";
        hash = "sha256-qYthiZlioD6fWCyDPfg7Yfo5PqCHzcenk8NjgobLW7c=";
      };
      vscodeServer = pkgs.srcOnly {
        name = "vscode-server-${rev}.tar.gz";
        src = pkgs.fetchurl {
          name = "vscode-server-${rev}.tar.gz";
          url = "https://update.code.visualstudio.com/commit:${rev}/server-linux-x64/stable";
          hash = "sha256-YilQLV1vQ1vHLa9pztvDIsaRz1CKzxcjT/INETrJy1I=";
        };
        stdenv = pkgs.stdenvNoCC;
      };
    }
  );
in
{
  # Apps we want to install on Linux but not on macOS
  home.packages = packages.sharedPackages ++ [
    vscodeOverride
    pkgs.bind
    pkgs.libnotify
  ];
}
