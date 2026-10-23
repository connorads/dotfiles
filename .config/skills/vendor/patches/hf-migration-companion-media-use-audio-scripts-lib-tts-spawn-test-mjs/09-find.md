  assert.equal(result.status, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, node);
  assert.deepEqual(captured[0].args, [npxCli, "hyperframes", "tts"]);
});

test("spawnP warns once with an accurate diagnostic when neither npx path exists", async () => {
  _resetNpxResolutionWarnForTests();
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(String(message));
  try {
    const env = { npm_execpath: "C:/missing/npm-cli.js", npm_node_execpath: "C:/node/node.exe" };
    const missing = () => false;
    assert.equal(
      (await spawnP("npx", ["hyperframes", "tts"], {}, "win32", fakeSpawn([]), env, missing))
        .status,
      -1,
    );
    assert.equal(
      (await spawnP("npx", ["hyperframes", "tts"], {}, "win32", fakeSpawn([]), env, missing))
        .status,
      -1,
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /npm_execpath \(C:\/missing\/npm-cli\.js\)/);
  assert.doesNotMatch(errors[0], /npm_execpath is not set/);
});
