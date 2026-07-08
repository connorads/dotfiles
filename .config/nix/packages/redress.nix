{
  lib,
  fetchFromGitHub,
  buildGo125Module,
}:

buildGo125Module rec {
  pname = "redress";
  version = "1.2.77";

  src = fetchFromGitHub {
    owner = "goretk";
    repo = "redress";
    rev = "v${version}";
    hash = "sha256-BCEbJvNm/Ng3x3hyx9KizD6rTQo4xH+6rmIcG5U375Q=";
  };

  vendorHash = "sha256-VwFGBDvOvovHp0KBYKfEOR+yBrIgwXjsDLEdb1AT9Vw=";

  ldflags = [
    "-s"
    "-w"
    "-X main.redressVersion=v${version}"
    "-X main.goreVersion=v0.14.1"
    "-X main.compilerVersion=go1.25"
  ];

  meta = {
    description = "Tool for analysing stripped Go binaries";
    homepage = "https://github.com/goretk/redress";
    changelog = "https://github.com/goretk/redress/releases/tag/v${version}";
    license = lib.licenses.agpl3Only;
    mainProgram = "redress";
  };
}
