{
  lib,
  rustPlatform,
  fetchFromGitHub,
  fetchpatch,
  git,
}:

rustPlatform.buildRustPackage {
  pname = "rift";
  version = "0.0.10";

  src = fetchFromGitHub {
    owner = "anomalyco";
    repo = "rift";
    rev = "18ca9d199cfa0033e1adf63b1eb6625fab89478a";
    hash = "sha256-/BBheYewi8jI6J/KcGZaG/SWNcvAH1mOf2QMVQKI0bM=";
  };

  patches = [
    (fetchpatch {
      url = "https://github.com/anomalyco/rift/commit/737c95072ef64acfa27ee84b06ad37395602d0b2.patch";
      hash = "sha256-up9Ths9daFMayIaclvcCGbKSIYOx1zdecivoZh5MEB0=";
    })
    (fetchpatch {
      url = "https://github.com/anomalyco/rift/commit/d67661ea66e773beba6a0b95938e97bbbf1451b3.patch";
      hash = "sha256-32zRufPJTmtZ+keTzW0giM65hV90QxkLSheMH4JDxk0=";
    })
    (fetchpatch {
      url = "https://github.com/anomalyco/rift/commit/4a38d7f7f07e1c319817cd970eeb1cb39dfef5f2.patch";
      hash = "sha256-88RF+sGjqxIckzaI32buQE9hfSmXFrpwpZbmKChDtOo=";
    })
  ];

  cargoHash = "sha256-JdIPIun3d5HURgX7m/HOspj5DJoLI6N8C1lmvvDVU4I=";
  cargoBuildFlags = [
    "--package"
    "rift-cli"
  ];
  cargoTestFlags = [ "--workspace" ];
  # These fixtures require one APFS volume spanning /private/tmp and TMPDIR,
  # and setuid/setgid bits unavailable in the Darwin build environment.
  checkFlags = [
    "--skip=strategy::apfs::tests::filtered_strategy_copies_entries_owned_by_another_group"
    "--skip=strategy::apfs::tests::filtered_strategy_preserves_included_metadata_and_hard_links"
  ];
  nativeCheckInputs = [ git ];
  RIFT_REQUIRE_APFS_TESTS = "1";

  meta = {
    description = "Copy-on-write development workspaces";
    homepage = "https://github.com/anomalyco/rift";
    license = lib.licenses.mit;
    mainProgram = "rift";
    platforms = lib.platforms.darwin;
  };
}
