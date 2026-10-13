async function confirmBootstrap(packageSpecs) {
  throw new Error("Required helper packages are missing. Add reviewed pinned versions with pnpm in the project; retain quarantine and install-script protections. Packages: " + packageSpecs.join(", "));
}
