import type { AmpReading, AmpOverview } from './amp-reading.ts';

interface Host { id: string; name: string; status: 'connected' | 'disconnected' }

export function createAmpSource(hosts: () => Promise<Host[]>, collect: (hostId: string) => Promise<AmpReading>, now = Date.now) {
  const cache = new Map<string, { reading: AmpReading; message: string | null; checkedAt: number }>();
  const pending = new Map<string, Promise<{ reading: AmpReading; message: string | null; checkedAt: number }>>();
  async function readHost(host: Host, refresh: boolean) {
    const cached = cache.get(host.id);
    if (host.status !== 'connected') return { reading: cached?.reading ?? { status: 'unavailable' as const, message: 'Machine is offline.' },
      message: 'Machine is offline.' };
    if (!refresh && cached && now() - cached.checkedAt < 60_000) return cached;
    const running = pending.get(host.id);
    if (running) return running;
    const request = collect(host.id).catch((): AmpReading => ({ status: 'unavailable', message: 'Amp usage could not be collected on this machine.' }))
      .then(reading => {
        const value = { reading: reading.status === 'unavailable' && cached?.reading.status === 'ok' ? cached.reading : reading,
          message: reading.status === 'unavailable' ? reading.message : null, checkedAt: now() };
        cache.set(host.id, value);
        return value;
      }).finally(() => pending.delete(host.id));
    pending.set(host.id, request);
    return request;
  }
  return { async read(refresh: boolean): Promise<AmpOverview> {
    return { machines: await Promise.all((await hosts()).map(async host => {
      const { reading, message } = await readHost(host, refresh);
      return { hostId: host.id, hostName: host.name, reading, message };
    })) };
  } };
}
