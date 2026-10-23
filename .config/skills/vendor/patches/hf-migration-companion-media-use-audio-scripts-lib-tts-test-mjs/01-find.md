});

// Kokoro shells out to `npx hyperframes tts`; a fake npx on PATH records the argv
// synthesizeOne really builds, so a dropped flag fails here. Windows runs npx via
// node directly, so the stub never resolves there.
async function kokoroArgv(options) {
  const dir = mkdtempSync(join(tmpdir(), "tts-kokoro-argv-"));
  const argvLog = join(dir, "argv.txt");
  writeFileSync(join(dir, "npx"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvLog}"\n`);
  chmodSync(join(dir, "npx"), 0o755);
  const originalPath = process.env.PATH;
  try {
