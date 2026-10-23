});

// A fake managed CLI records the actual Kokoro arguments without synthesis.
async function kokoroArgv(options) {
  const dir = mkdtempSync(join(tmpdir(), "tts-kokoro-argv-"));
  const argvLog = join(dir, "argv.txt");
  writeFileSync(join(dir, "hyperframes"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvLog}"\n`);
  chmodSync(join(dir, "hyperframes"), 0o755);
  const originalPath = process.env.PATH;
  try {
