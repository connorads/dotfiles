});

test("resolveSpawnCommand uses the managed CLI on win32 without a shell", () => {
  const resolved = resolveSpawnCommand(
    "npx",
