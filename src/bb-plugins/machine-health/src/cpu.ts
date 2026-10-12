// CPU% from cumulative per-core tick counters (`os.cpus()[].times`), the
// counters iostat itself reads. A warm worker diffs against its last call, so
// a reading costs no wait; only a cold or stale baseline pays a short window.
// This replaces status-right.sh's lock + background sampler + cache file.

export type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number };
export type CpuSnapshot = { busy: number; total: number };

export function snapshot(cores: readonly { times: CpuTimes }[]): CpuSnapshot {
  let busy = 0;
  let total = 0;
  for (const { times } of cores) {
    const all = times.user + times.nice + times.sys + times.idle + times.irq;
    total += all;
    busy += all - times.idle;
  }
  return { busy, total };
}

/** Null when the counters did not move (or went backwards after a resume); clamped so a skewed idle counter cannot break the 0-100 contract. */
export function percentBetween(before: CpuSnapshot, after: CpuSnapshot): number | null {
  const total = after.total - before.total;
  const busy = after.busy - before.busy;
  if (total <= 0 || busy < 0) return null;
  return Math.min(100, Math.round((1000 * busy) / total) / 10);
}

export type CpuSamplerDeps = {
  read: () => CpuSnapshot;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Window for a cold sample. */
  windowMs: number;
  /** A baseline older than this measures too long a span to mean "now". */
  maxAgeMs: number;
};

export function createCpuSampler(deps: CpuSamplerDeps) {
  let last: { at: number; snap: CpuSnapshot } | null = null;
  let lastPct: number | null = null;
  return async function sample(): Promise<number | null> {
    let base = last;
    const age = base ? deps.now() - base.at : Infinity;
    // Two callers inside one window would diff a few ticks: repeat the last figure instead.
    if (base && age < deps.windowMs && lastPct !== null) return lastPct;
    if (!base || age > deps.maxAgeMs) {
      base = { at: deps.now(), snap: deps.read() };
      await deps.sleep(deps.windowMs);
    }
    const current = { at: deps.now(), snap: deps.read() };
    last = current;
    lastPct = percentBetween(base.snap, current.snap) ?? lastPct;
    return lastPct;
  };
}
