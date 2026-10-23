  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  for (const c of [
