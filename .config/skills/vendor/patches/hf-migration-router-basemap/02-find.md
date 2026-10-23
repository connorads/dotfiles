  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  const base = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  if (existsSync(base)) {
    for (const v of readdirSync(base).sort().reverse()) {
      // lexical sort; any working binary is fine
      try {
        for (const inner of readdirSync(join(base, v))) {
          const bin = join(base, v, inner, exe);
          if (existsSync(bin)) return bin;
        }
      } catch {
        /* skip */
      }
    }
  }
  for (const c of [
