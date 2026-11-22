test(
  "without a handed-over CLI it uses the managed hyperframes binary instead of npx",
  { skip: process.platform === "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "media-use-transcribe-"));
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      const marker = join(root, "npx-ran");
      writeFileSync(join(bin, "npx"), `#!/bin/sh\ntouch "${marker}"\n`);
      chmodSync(join(bin, "npx"), 0o755);
      writeFileSync(
        join(bin, "hyperframes"),
        `#!/bin/sh\nwhile [ "$1" != "--dir" ]; do shift; done\n` +
          `echo '[{"text":"a","start":0,"end":1}]' > "$2/transcript.json"\n` +
          `echo '{"ok":true,"engine":"whisper"}'\n`,
      );
      chmodSync(join(bin, "hyperframes"), 0o755);
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
      assert.equal(res.status, 0, res.stderr);
      assert.equal(JSON.parse(res.stdout.trim()).engine, "whisper");
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
