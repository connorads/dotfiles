{
  lib,
  stdenvNoCC,
  fetchurl,
  installShellFiles,
}:

stdenvNoCC.mkDerivation rec {
  pname = "atuin";
  version = "18.23.0";

  src = fetchurl {
    url = "https://github.com/atuinsh/atuin/releases/download/v${version}/atuin-aarch64-apple-darwin.tar.gz";
    hash = "sha256-yYi+HN4ZzXKVzmS8i5VdQvsYVeUifLZAyH/AnIQIw/w=";
  };

  nativeBuildInputs = [ installShellFiles ];
  dontBuild = true;
  dontStrip = true;

  installPhase = ''
    runHook preInstall
    install -Dm755 atuin $out/bin/atuin
    installShellCompletion --cmd atuin \
      --bash <($out/bin/atuin gen-completions --shell bash) \
      --fish <($out/bin/atuin gen-completions --shell fish) \
      --zsh <($out/bin/atuin gen-completions --shell zsh)
    runHook postInstall
  '';

  meta = {
    description = "Shell history with encrypted synchronisation (upstream release binary)";
    homepage = "https://atuin.sh";
    license = lib.licenses.mit;
    mainProgram = "atuin";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
