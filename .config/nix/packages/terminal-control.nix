{
  lib,
  stdenv,
  rustPlatform,
  fetchFromGitHub,
  zig_0_15,
  cctools,
}:

rustPlatform.buildRustPackage rec {
  pname = "terminal-control";
  version = "0.6.0";

  src = fetchFromGitHub {
    owner = "anomalyco";
    repo = "terminal-control";
    rev = "v${version}";
    hash = "sha256-gM3mBaIHuLnt3G3dxvdvqZaMNCb0sx8krnEThrcurbc=";
  };

  cargoHash = "sha256-7K2b3sbTHQvz+aezv/wOjYYJUvHokjy79GoR3loHgwc=";

  # libghostty-vt-sys builds ghostty's vt library via `zig build` at compile
  # time and would otherwise `git clone` its pinned ghostty commit from the
  # network. Feed it the same commit as a fixed-output fetch instead
  # (GHOSTTY_SOURCE_DIR is build.rs's sanctioned offline override).
  ghosttySrc = fetchFromGitHub {
    owner = "ghostty-org";
    repo = "ghostty";
    rev = "a887df42c56f6de86c0fe6da9c4eeca37931e083"; # libghostty-vt-sys 0.2.1's GHOSTTY_COMMIT
    hash = "sha256-1Zz65SCk3rkJ9+Q0MmyNOTNiDSLBRIHRd3IvFM4iNXw=";
  };

  # ghostty pins zig 0.15 (requireZig rejects newer zig); cctools supplies the
  # Apple libtool ghostty's fat-static-lib install step spawns on darwin.
  nativeBuildInputs = [ zig_0_15 ] ++ lib.optionals stdenv.hostPlatform.isDarwin [ cctools ];

  # zig is needed on PATH for libghostty-vt-sys's build.rs only; keep zig's
  # setup hook from hijacking the cargo build/check/install phases.
  dontUseZigBuild = true;
  dontUseZigCheck = true;
  dontUseZigInstall = true;

  preBuild = ''
    cp -r ${ghosttySrc} ghostty-src
    chmod -R u+w ghostty-src
    export GHOSTTY_SOURCE_DIR=$PWD/ghostty-src
    export ZIG_GLOBAL_CACHE_DIR=$TMPDIR/zig-global-cache
  ''
  + lib.optionalString stdenv.hostPlatform.isDarwin ''
    # zig's Darwin libc discovery shells out to xcode-select/xcrun, which
    # don't exist in the sandbox; answer both from the stdenv apple-sdk.
    : "''${SDKROOT:?SDKROOT unset - darwin stdenv should provide an apple-sdk}"
    mkdir -p sdk-shims
    printf '#!/bin/sh\necho "%s"\n' "$SDKROOT" > sdk-shims/xcode-select
    printf '#!/bin/sh\necho "%s"\n' "$SDKROOT" > sdk-shims/xcrun
    chmod +x sdk-shims/xcode-select sdk-shims/xcrun
    export PATH=$PWD/sdk-shims:$PATH
  '';

  # PTY/snapshot tests may need a live terminal; build the bin, skip crate tests.
  doCheck = false;

  meta = {
    description = "Drive, inspect and test terminal apps in a real PTY (termctrl)";
    homepage = "https://github.com/anomalyco/terminal-control";
    license = lib.licenses.mit;
    mainProgram = "termctrl";
    platforms = lib.platforms.unix;
  };
}
