{
  lib,
  fetchCrate,
  rustPlatform,
}:

rustPlatform.buildRustPackage rec {
  pname = "cargo-fframes";
  version = "1.2.0";

  src = fetchCrate {
    inherit pname version;
    hash = "sha256-/sxX3jmVL5abMw+M2Ibmcnty8NvuTjvX5HV0ic/HiL4=";
  };

  cargoHash = "sha256-PkOW049BZhJt1wrdYuIlYC+wW7zi340fMWE8FTXRyMA=";

  meta = {
    description = "Project generator for fframes code-rendered videos";
    homepage = "https://github.com/dmtrKovalenko/fframes";
    license = lib.licenses.mit;
    mainProgram = "cargo-fframes";
  };
}
