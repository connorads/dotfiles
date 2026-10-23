  assert.equal(result.status, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "hyperframes");
  assert.deepEqual(captured[0].args, ["tts"]);
});

test("non-HyperFrames npx bootstrap is rejected before spawn", () => {
  assert.throws(() => resolveSpawnCommand("npx", ["unmanaged-tool"]), /bootstrap is disabled/);
});

test("managed launches preserve shell metacharacters as literal arguments", () => {
  const result = resolveSpawnCommand("npx", ["hyperframes", "tts", "hello; touch ignored"], { shell: true });
  assert.equal(result.cmd, "hyperframes");
  assert.deepEqual(result.args, ["tts", "hello; touch ignored"]);
  assert.equal(result.opts.shell, false);
});
