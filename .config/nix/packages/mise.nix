{
  lib,
  stdenvNoCC,
  fetchurl,
  installShellFiles,
}:

let
  version = "2026.9.12";

  # Upstream's release tarballs, checked against the release's SHASUMS256.txt.
  # Linux takes the static musl build so no glibc from the host is involved.
  sources = {
    aarch64-darwin = {
      suffix = "macos-arm64";
      hash = "sha256-Dxx/PnTYya6Cl25pkAWPK8aIIazGtMN6aMIGyDZpJBk=";
    };
    x86_64-linux = {
      suffix = "linux-x64-musl";
      hash = "sha256-GyBR2NPvq02chc61mEmj6wUtskrUBqOQH9a0U3TFbr4=";
    };
    aarch64-linux = {
      suffix = "linux-arm64-musl";
      hash = "sha256-Iufs08bITvNuTQx4xO70mnnj+4OqiOCR4pk/2cmj+KE=";
    };
  };

  system = stdenvNoCC.hostPlatform.system;
  source = sources.${system} or (throw "mise: no release binary for ${system}");
in
stdenvNoCC.mkDerivation {
  pname = "mise";
  inherit version;

  src = fetchurl {
    url = "https://github.com/jdx/mise/releases/download/v${version}/mise-v${version}-${source.suffix}.tar.gz";
    inherit (source) hash;
  };

  sourceRoot = "mise";

  nativeBuildInputs = [ installShellFiles ];

  # The tarball ships no completions; the binary generates self-contained ones.
  installPhase = ''
    runHook preInstall
    install -Dm755 bin/mise $out/bin/mise
    # mise's packaging hook: a store install cannot self-update in place.
    install -Dm644 /dev/null $out/lib/mise/.disable-self-update
    installManPage man/man1/mise.1
    export HOME=$TMPDIR
    installShellCompletion --cmd mise \
      --bash <($out/bin/mise completion bash) \
      --fish <($out/bin/mise completion fish) \
      --zsh <($out/bin/mise completion zsh)
    runHook postInstall
  '';

  meta = {
    description = "Dev tools, env vars and task runner (upstream release binary)";
    homepage = "https://mise.jdx.dev";
    license = lib.licenses.mit;
    mainProgram = "mise";
    platforms = builtins.attrNames sources;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
