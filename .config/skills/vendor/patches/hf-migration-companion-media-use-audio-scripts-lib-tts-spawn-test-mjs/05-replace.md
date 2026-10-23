  );
  assert.ok(resolved);
  assert.deepEqual(resolved.args, ["tts", "hello & calc"]);
});

test("spawnP uses the managed CLI for legacy npx requests on win32", async () => {
  const captured = [];
  await spawnP(
