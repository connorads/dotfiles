{
  lib,
  stdenv,
  fetchFromGitHub,
  pkg-config,
  hidapi,
}:

# nixpkgs' own `footswitch` is `platforms.linux` (it uses udevCheckHook), so it
# does not evaluate on darwin, and its snapshot (2023-10-10) predates the fix
# that opens HID interface 1 explicitly. The PCsensor pedal is a composite
# device whose interface 0 is the keyboard macOS refuses to open, so the old
# `hid_open(vid,pid)` path fails on macOS depending on enumeration order.
stdenv.mkDerivation {
  pname = "footswitch";
  version = "0-unstable-2026-06-24";

  src = fetchFromGitHub {
    owner = "rgerganov";
    repo = "footswitch";
    rev = "454e00b517cf6eaaa4dc5c6c15403732bc2365aa";
    hash = "sha256-/AyHJK7N3sGpI8iNWALVT4sxqiK4dFPkp9KhZ8j+xY0=";
  };

  nativeBuildInputs = [ pkg-config ];
  buildInputs = [ hidapi ];

  makeFlags = [ "PREFIX=$(out)" ];

  # The install target copies into $(PREFIX)/bin without creating it.
  preInstall = "mkdir -p $out/bin";

  meta = {
    description = "Configure PCsensor and Scythe USB foot switches";
    homepage = "https://github.com/rgerganov/footswitch";
    license = lib.licenses.mit;
    mainProgram = "footswitch";
    platforms = lib.platforms.unix;
  };
}
