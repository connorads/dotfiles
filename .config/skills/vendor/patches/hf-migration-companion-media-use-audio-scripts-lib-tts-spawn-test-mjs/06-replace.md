  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, "hyperframes");
  assert.deepEqual(captured[0].args, ["tts"]);
  assert.equal(captured[0].opts.shell, false);
});
