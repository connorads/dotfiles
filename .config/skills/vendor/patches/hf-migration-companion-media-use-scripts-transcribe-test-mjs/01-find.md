test(
  "without a handed-over CLI it fails with the fix instead of running npx in the project",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "media-use-transcribe-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      const marker = join(root, "npx-ran");
      writeFileSync(join(bin, "npx"), `#!/bin/sh\ntouch "${marker}"\n`);
      chmodSync(join(bin, "npx"), 0o755);
      const input = join(root, "in.wav");
      writeFileSync(input, "");
      const script = fileURLToPath(new URL("./transcribe.mjs", import.meta.url));
      const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        HYPERFRAMES_MEDIA_HOME: join(root, "home"),
        HYPERFRAMES_NO_TELEMETRY: "1",
      };
      delete env.HYPERFRAMES_PARAKEET;
      delete env.HYPERFRAMES_CLI_ENTRY;
      const res = spawnSync(
        process.execPath,
        [script, "--input", input, "--engine", "whisper", "--json"],
        { cwd: root, encoding: "utf8", env },
      );
      assert.equal(res.status, 1);
      assert.match(JSON.parse(res.stdout.trim()).error, /HYPERFRAMES_CLI_ENTRY/);
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
