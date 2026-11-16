import { z } from 'zod';
import type { Measurement } from '../usage-source.ts';
import { antigravityProviderId } from '../antigravity-account.ts';

const locator = z.union([z.tuple([z.literal('antigravity'), z.string().min(1)]),
  z.tuple([z.literal('antigravity'), z.string().min(1), z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u)])]);
function decode(id: string) { return locator.parse(JSON.parse(id)); }

export function createAntigravitySource(collect: (hostId: string, accountId: string) => Promise<Measurement>, now = Date.now) {
  const cache = new Map<string, { value: Measurement; checkedAt: number }>();
  const successful = new Map<string, Measurement>();
  const pending = new Map<string, Promise<Measurement>>();
  return {
    owns(id: string) { try { decode(id); return true; } catch { return false; } },
    lastReading(id: string) { decode(id); return successful.get(id); },
    resources(hosts: { id: string; name: string; accounts?: { id: string; label: string }[] }[]) {
      return hosts.flatMap(host => (host.accounts ?? [{ id: 'default', label: 'Default' }]).map(account => ({
        id: JSON.stringify(account.id === 'default' ? ['antigravity', host.id] : ['antigravity', host.id, account.id]), accountKey: null,
        providerId: antigravityProviderId(account.id), label: account.id === 'default' ? 'Antigravity' : `Antigravity · ${account.label}`,
        scope: { kind: 'host' as const, hostId: host.id, hostName: host.name } })));
    },
    async read(id: string, refresh: boolean): Promise<Measurement> {
      const [, hostId, accountId = 'default'] = decode(id);
      const previous = cache.get(id);
      const age = previous?.value.usage.status === 'ok' ? 120_000 : 30_000;
      if (!refresh && previous && now() - previous.checkedAt < age) return previous.value;
      const running = pending.get(id);
      if (running) return running;
      const request = collect(hostId, accountId).catch((): Measurement => ({ accountKey: null, observedAt: null,
        usage: { status: 'error', plan: null, accountEmail: null, planLabel: null,
          message: 'Antigravity quota refresh failed on this host.' } }))
        .then(value => {
          if (value.usage.status === 'ok') successful.set(id, value);
          cache.set(id, { value, checkedAt: now() });
          return value;
        })
        .finally(() => pending.delete(id));
      pending.set(id, request);
      return request;
    },
  };
}
