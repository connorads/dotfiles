});

test("spawnP uses the managed CLI without npm on win32", async () => {
  _resetNpxResolutionWarnForTests();
  const captured = [];
