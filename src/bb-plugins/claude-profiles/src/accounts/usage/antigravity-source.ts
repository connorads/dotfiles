import { z } from 'zod';
import type { Measurement } from '../usage-source.ts';

const locator = z.tuple([z.literal('antigravity'), z.string().min(1)]);
function decode(id: string) { return locator.parse(JSON.parse(id)); }

export function createAntigravitySource(collect: (hostId: string) => Promise<Measurement>, now = Date.now) {
  const cache = new Map<string, { value: Measurement; checkedAt: number }>();
  const successful = new Map<string, Measurement>();
  const pending = new Map<string, Promise<Measurement>>();
  return {
    owns(id: string) { try { decode(id); return true; } catch { return false; } },
    lastReading(id: string) { return successful.get(decode(id)[1]); },
    resources(hosts: { id: string; name: string }[]) {
      return hosts.map(host => ({ id: JSON.stringify(['antigravity', host.id]), accountKey: null,
        providerId: 'acp-antigravity', label: 'Antigravity',
        scope: { kind: 'host' as const, hostId: host.id, hostName: host.name } }));
    },
    async read(id: string, refresh: boolean): Promise<Measurement> {
      const [, hostId] = decode(id);
      const previous = cache.get(hostId);
      const age = previous?.value.usage.status === 'ok' ? 120_000 : 30_000;
      if (!refresh && previous && now() - previous.checkedAt < age) return previous.value;
      const running = pending.get(hostId);
      if (running) return running;
      const request = collect(hostId).catch((): Measurement => ({ accountKey: null, observedAt: null,
        usage: { status: 'error', plan: null, accountEmail: null, planLabel: null,
          message: 'Antigravity quota refresh failed on this host.' } }))
        .then(value => {
          if (value.usage.status === 'ok') successful.set(hostId, value);
          cache.set(hostId, { value, checkedAt: now() });
          return value;
        })
        .finally(() => pending.delete(hostId));
      pending.set(hostId, request);
      return request;
    },
  };
}
