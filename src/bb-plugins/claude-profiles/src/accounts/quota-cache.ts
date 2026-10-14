import type { Usage } from './quota.ts';

export interface QuotaConfig { profileRoot: string; executable: string }

// A success outlives the header badge's two-minute poll; a failure is retried after a minute.
const OK_TTL = 300_000;
const FAILED_TTL = 60_000;

/** One reading per host, root, executable and profile, shared by every caller. */
export function createQuotaCache(read: (hostId: string, config: QuotaConfig, profileId: string) => Promise<Usage>) {
  const cache = new Map<string, { value: Usage; storedAt: number }>();
  const probes = new Map<string, Promise<Usage>>();
  return async function hostUsage(hostId: string, config: QuotaConfig, profileId: string, refresh: boolean): Promise<Usage> {
    const cacheKey = JSON.stringify([hostId, config.profileRoot, config.executable, profileId]);
    const entry = cache.get(cacheKey);
    if (!refresh && entry && Date.now() - entry.storedAt < (entry.value.status === 'ok' ? OK_TTL : FAILED_TTL)) return entry.value;
    const running = probes.get(cacheKey);
    if (running) return running;
    const request = read(hostId, config, profileId).then(result => {
      const value = { ...result, observedAt: result.observedAt ?? entry?.value.observedAt ?? null };
      cache.set(cacheKey, { value, storedAt: Date.now() }); return value;
    }).finally(() => probes.delete(cacheKey));
    probes.set(cacheKey, request);
    return request;
  };
}
