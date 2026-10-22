{
  lib,
  fetchurl,
  linkFarm,
  mkShellNoCC,
  cargo-fframes,
  x264,
}:

let
  # ffmpeg-sys-fframes and skia-bindings download these from build.rs, which
  # build-wrap's sandbox denies network. Each key encodes the crate version
  # (tag), target and enabled features: a cargo-fframes bump or a new codec
  # feature changes it, and the build then fails with the exact URL to pin here.
  ffmpeg = tag: key: hash: {
    name = "ffmpeg/${tag}/ffmpeg-${key}.tar.gz";
    path = fetchurl {
      url = "https://github.com/dmtrKovalenko/rust-ffmpeg-sys/releases/download/${tag}/ffmpeg-${key}.tar.gz";
      inherit hash;
    };
  };
  skia = tag: key: hash: {
    name = "skia/${tag}/skia-binaries-${key}.tar.gz";
    path = fetchurl {
      url = "https://github.com/rust-skia/skia-binaries/releases/download/${tag}/skia-binaries-${key}.tar.gz";
      inherit hash;
    };
  };

  binaries = linkFarm "fframes-binaries" [
    (ffmpeg "binaries-9.0.0"
      "aarch64-apple-darwin-avcodec-avdevice-avfilter-avformat-swresample-swscale-videotoolbox"
      "sha256-WsVxt/fpm+LcfwAoi9BzvtoxTA0haY10PzwFF21R6cE="
    )
    (ffmpeg "binaries-9.0.0"
      "aarch64-apple-darwin-avcodec-avdevice-avfilter-avformat-gpl-swresample-swscale-x264"
      "sha256-OxJFLOjeA2943hB0hxLKCNAt4M4RUbtsr6Vwe794XjA="
    )
    (skia "0.153.3"
      "b7f043e0b1e2a850e702-aarch64-apple-darwin-ganesh-gl-jpegd-jpege-metal-pdf-svg-textlayout"
      "sha256-awG8bXe7Nzvl1jtgSmW/+FB0UDrcafBjqrswD5hsNFU="
    )
  ];
in
mkShellNoCC {
  packages = [ cargo-fframes ];

  FFMPEG_BINARIES_CACHE = "${binaries}/ffmpeg";
  SKIA_BINARIES_URL = "file://${binaries}/skia/{tag}/skia-binaries-{key}.tar.gz";
  LIBRARY_PATH = lib.makeLibraryPath [ x264 ];
}
