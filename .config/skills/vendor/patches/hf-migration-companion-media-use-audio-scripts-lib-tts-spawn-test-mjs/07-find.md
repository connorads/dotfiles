  const captured = [];
  await spawnP("npx", ["hyperframes", "tts"], {}, "darwin", fakeSpawn(captured));
  assert.equal(captured[0].cmd, "npx");
  assert.deepEqual(captured[0].args, ["hyperframes", "tts"]);
  assert.equal(captured[0].opts.shell, undefined);
});
