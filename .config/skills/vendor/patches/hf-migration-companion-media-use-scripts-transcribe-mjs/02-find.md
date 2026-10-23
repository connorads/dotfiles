  const workDir = mkdtempSync(join(tmpdir(), "media-use-whisper-"));
  try {
    // On Windows a bare "npx" is npx.cmd, which execFileSync cannot exec
    // (spawnSync npx ENOENT) — resolveNpxInvocation reroutes it through
    // node + npx-cli.js (and throws actionably when it can't), same
    // mechanism as the audio engine's TTS spawns.
    // Under auto or parakeet the CLI may run its own Parakeet; --json says which engine ran.
    const resolved = resolveNpxInvocation(
