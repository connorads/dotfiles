import type { Usage } from './quota.ts';

export interface QuotaConfig { profileRoot: string; executable: string }

/** One reading per host, root, executable and profile for a minute, shared by every caller. */
export function createQuotaCache(read: (hostId: string, config: QuotaConfig, profileId: string) => Promise<Usage>) {
  const cache = new Map<string, Usage>();
  const probes = new Map<string, Promise<Usage>>();
  return async function hostUsage(hostId: string, config: QuotaConfig, profileId: string, refresh: boolean): Promise<Usage> {
    const cacheKey = JSON.stringify([hostId, config.profileRoot, config.executable, profileId]);
    const cached = cache.get(cacheKey);
    if (!refresh && cached?.status === 'ok' && cached.observedAt && Date.now() - cached.observedAt < 60000) return cached;
    const running = probes.get(cacheKey);
    if (running) return running;
    const request = read(hostId, config, profileId).then(result => {
      const value = { ...result, observedAt: result.observedAt ?? cached?.observedAt ?? null };
      cache.set(cacheKey, value); return value;
    }).finally(() => probes.delete(cacheKey));
    probes.set(cacheKey, request);
    return request;
  };
}
