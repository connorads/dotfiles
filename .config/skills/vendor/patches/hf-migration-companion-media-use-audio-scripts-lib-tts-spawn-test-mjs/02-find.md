});

test("resolveSpawnCommand routes npx through node+npx-cli on win32 without shell:true", () => {
  const resolved = resolveSpawnCommand(
    "npx",
