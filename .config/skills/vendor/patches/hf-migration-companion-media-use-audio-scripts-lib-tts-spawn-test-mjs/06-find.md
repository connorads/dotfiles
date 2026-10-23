  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0].cmd, envWithNpxCli.npm_node_execpath);
  assert.deepEqual(captured[0].args, [npxCliPath, "hyperframes", "tts"]);
  assert.equal(captured[0].opts.shell, undefined);
});
