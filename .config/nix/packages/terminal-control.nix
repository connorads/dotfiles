{
  lib,
  rustPlatform,
  fetchFromGitHub,
}:

rustPlatform.buildRustPackage rec {
  pname = "terminal-control";
  version = "0.4.1";

  src = fetchFromGitHub {
    owner = "anomalyco";
    repo = "terminal-control";
    rev = "v${version}";
    hash = "sha256-3PTPo42W19aFFSDamOMbvGiIkz7ZyZ/VpL/2E9fZjc4=";
  };

  cargoHash = "sha256-NWnDqaAeVxKgf6eKEVkaU2XldaE2IudMaUwDWChlVPQ=";

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
