    // A throwaway profile per run, its cache capped (each run starts cold anyway), removed on exit. It is
    // claimed with an owner file before Chrome starts, so another run's sweep can tell when it was abandoned.
    const base = process.env.TASTE_SKILL_TMP || tmpdir();
    sweepProfiles(base);
    const dir = mkdtempSync(join(base, 'ad-chrome-'));
    const claim = (chrome) => {
      try { writeFileSync(join(dir, OWNER), JSON.stringify({ host: hostname(), pid: process.pid, chrome })); } catch {}
    };
    claim();
