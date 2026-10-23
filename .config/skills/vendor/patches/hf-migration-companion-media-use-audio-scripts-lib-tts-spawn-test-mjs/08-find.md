});

test("spawnP resolves npx beside node when npm_execpath is unset on win32", async () => {
  _resetNpxResolutionWarnForTests();
  const captured = [];
