// Profiles from runs that were killed before close(): removed once no Chrome holds them (a running
// Chrome keeps the profile's lockfile open) and they are a few minutes old.
function sweepProfiles(base) {
  try {
    const cutoff = Date.now() - 3 * 60 * 1000;
    for (const name of readdirSync(base)) {
      if (!name.startsWith('ad-chrome-')) continue;
      const p = join(base, name);
      try {
        if (statSync(p).mtimeMs > cutoff) continue;
        const lock = join(p, 'lockfile');
        if (existsSync(lock)) closeSync(openSync(lock, 'r+')); // throws while a Chrome holds it
        rmSync(p, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}
