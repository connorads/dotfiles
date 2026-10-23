} else if (cmd === "auto") {
  // OPTIONAL fast path — only if a strong detector key happens to exist. Never assume it.
  const key = process.env.GEMINI_API_KEY;
