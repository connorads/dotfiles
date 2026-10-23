  const workDir = mkdtempSync(join(tmpdir(), "media-use-whisper-"));
  try {
    // The local launcher preserves each argument and uses only the managed CLI.
    // Under auto or parakeet the CLI may run its own Parakeet; --json says which engine ran.
    const resolved = resolveNpxInvocation(
