test(
  "kokoro and transcription without a handed-over CLI fail with the fix, never npx",
  { skip: process.platform === "win32" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "tts-kokoro-no-cli-"));
    const marker = join(dir, "npx-ran");
    writeFileSync(join(dir, "npx"), `#!/bin/sh\ntouch "${marker}"\n`);
    chmodSync(join(dir, "npx"), 0o755);
    const saved = { PATH: process.env.PATH, entry: process.env.HYPERFRAMES_CLI_ENTRY };
    const originalError = console.error;
    const errors = [];
    try {
      process.env.PATH = dir;
      delete process.env.HYPERFRAMES_CLI_ENTRY;
      console.error = (message) => errors.push(String(message));
      _resetNpxResolutionWarnForTests();
      const res = await synthesizeOne({
        provider: "kokoro",
        text: "hi",
        voiceId: "am_michael",
        wavAbs: join(dir, "line-0.wav"),
        hyperframesDir: dir,
      });
      assert.equal(res.ok, false);
      assert.match(res.error, /HYPERFRAMES_CLI_ENTRY/);
      assert.equal(await transcribeWav({ wavRel: "line-0.wav", hyperframesDir: dir }), null);
      assert.equal(existsSync(marker), false);
      assert.equal(errors.length, 1);
    } finally {
      console.error = originalError;
      process.env.PATH = saved.PATH;
      if (saved.entry !== undefined) process.env.HYPERFRAMES_CLI_ENTRY = saved.entry;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
