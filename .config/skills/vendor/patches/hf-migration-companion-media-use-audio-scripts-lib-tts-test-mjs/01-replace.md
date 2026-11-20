test(
  "kokoro without a handed-over CLI uses managed hyperframes, never npx",
  { skip: process.platform === "win32" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "tts-kokoro-no-cli-"));
    const marker = join(dir, "npx-ran");
    const hfMarker = join(dir, "hf-ran");
    writeFileSync(join(dir, "npx"), `#!/bin/sh\n: > "${marker}"\n`);
    chmodSync(join(dir, "npx"), 0o755);
    writeFileSync(join(dir, "hyperframes"), `#!/bin/sh\n: > "${hfMarker}"\nexit 1\n`);
    chmodSync(join(dir, "hyperframes"), 0o755);
    const saved = { PATH: process.env.PATH, entry: process.env.HYPERFRAMES_CLI_ENTRY };
    try {
      process.env.PATH = dir;
      delete process.env.HYPERFRAMES_CLI_ENTRY;
      _resetNpxResolutionWarnForTests();
      const res = await synthesizeOne({
        provider: "kokoro",
        text: "hi",
        voiceId: "am_michael",
        wavAbs: join(dir, "line-0.wav"),
        hyperframesDir: dir,
      });
      assert.equal(res.ok, false);
      assert.equal(existsSync(hfMarker), true);
      assert.equal(existsSync(marker), false);
    } finally {
      process.env.PATH = saved.PATH;
      if (saved.entry !== undefined) process.env.HYPERFRAMES_CLI_ENTRY = saved.entry;
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
