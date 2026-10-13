import { z } from 'zod';
import type { Measurement } from '../usage-source.ts';

const locator = z.tuple([z.literal('grok'), z.string().min(1)]);
function decode(id: string) {
  try { return locator.parse(JSON.parse(id)); }
  catch { throw new Error('Invalid Grok usage resource.'); }
}

export function createGrokSource(collect: (hostId: string) => Promise<Measurement>, now = Date.now) {
  const cache = new Map<string, Measurement>();
  const pending = new Map<string, Promise<Measurement>>();
  return {
    owns(id: string) {
      try { return locator.safeParse(JSON.parse(id)).success; } catch { return false; }
    },
    resources(hosts: { id: string; name: string }[]) {
      return hosts.map(host => ({ id: JSON.stringify(['grok', host.id]), accountKey: null,
        providerId: 'acp-grok', label: 'Grok Build',
        scope: { kind: 'host' as const, hostId: host.id, hostName: host.name } }));
    },
    async read(id: string, refresh: boolean): Promise<Measurement> {
      const [, hostId] = decode(id);
      const previous = cache.get(hostId);
      if (!refresh && previous?.usage.status === 'ok' && previous.observedAt !== null && now() - previous.observedAt < 60_000)
        return previous;
      const running = pending.get(hostId);
      if (running) return running;
      const request = collect(hostId).catch((): Measurement => ({ accountKey: null, observedAt: null,
        usage: { status: 'error', plan: null, accountEmail: null, planLabel: null, message: 'Grok usage refresh failed on this host.' } }))
        .then(value => {
          const result = { ...value, observedAt: value.observedAt ?? previous?.observedAt ?? null };
          cache.set(hostId, result);
          return result;
        }).finally(() => pending.delete(hostId));
      pending.set(hostId, request);
      return request;
    },
  };
}
