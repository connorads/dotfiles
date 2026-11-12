{
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation rec {
  pname = "fresh-editor";
  version = "0.5.4";

  src = fetchurl {
    url = "https://github.com/sinelaw/fresh/releases/download/v${version}/fresh-editor-aarch64-apple-darwin.tar.xz";
    hash = "sha256-xyLOmub5L5xPW6ES8Ycpa6W7tT1T4MgkeCSb7MmFnMQ=";
  };

  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 fresh $out/bin/fresh
    runHook postInstall
  '';

  meta = {
    description = "Terminal text editor (upstream release binary)";
    homepage = "https://github.com/sinelaw/fresh";
    license = lib.licenses.gpl3Plus;
    mainProgram = "fresh";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
