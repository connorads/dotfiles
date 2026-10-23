  );
  assert.ok(resolved);
  assert.deepEqual(resolved.args, [npxCliPath, "hyperframes", "tts", "hello & calc"]);
});

test("spawnP uses the resolved node+npx-cli command for npx on win32", async () => {
  const captured = [];
  await spawnP(
