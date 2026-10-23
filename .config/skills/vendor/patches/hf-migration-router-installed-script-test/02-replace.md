test("skill scripts detect their CLI entry through lib/main-module.mjs only", () => {
  const handRolled = skillScripts(SKILLS).filter(
    (path) =>
