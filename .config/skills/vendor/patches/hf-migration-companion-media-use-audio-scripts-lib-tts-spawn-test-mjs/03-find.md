  );
  assert.ok(resolved);
  assert.equal(resolved.cmd, envWithNpxCli.npm_node_execpath);
  assert.deepEqual(resolved.args, [
    npxCliPath,
    "hyperframes",
    "tts",
    "C:\\Users\\Test User\\line.txt",
