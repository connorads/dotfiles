    // A throwaway profile per run. Its cache is capped (each run starts cold anyway), profiles left by
    // runs that were killed are swept once they are a few hours old, and the profile goes on exit.
    const base = process.env.TASTE_SKILL_TMP || tmpdir();
    sweepProfiles(base);
