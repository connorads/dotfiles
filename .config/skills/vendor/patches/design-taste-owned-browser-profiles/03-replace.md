    // A throwaway profile per run. Clean up only the directory created below.
    const base = process.env.TASTE_SKILL_TMP || tmpdir();
    const dir = mkdtempSync(join(base, 'ad-chrome-'));
