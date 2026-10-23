test("skill scripts detect their CLI entry through lib/main-module.mjs only", () => {
  const handRolled = [...skillScripts(SKILLS), ...skillScripts(CLI_MEDIA_USE)].filter(
    (path) =>
