import { cliCommand, defineCli, type BbPluginApi } from '@get-bb/plugin-sdk';
import { hostContract, rpcContract, type Plan, type Progress, type SummaryView } from './contracts.ts';
import { Ledger, migrations, type Database, type FileCursor } from './src/ledger.ts';
import { parseLiteLlm, priceSourceUrl } from './src/prices.ts';
import { groupProjects, localDay, summarise, threadCost, type ProjectRef } from './src/report.ts';
import { downsample, foldThreads, growth, requestCosts, rootOf, type InsightPoint } from './src/insights.ts';
import type { UsageRow } from './src/ledger.ts';
import type { Provider } from './src/records.ts';
export { rpcContract } from './contracts.ts';

const day = 86_400_000;
const idle = (): Progress => ({ state: 'idle', startedAt: null, finishedAt: null, error: null, files: 0, filesDone: 0, bytes: 0, bytesDone: 0, records: 0 });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** `Name = 200` per line, in US dollars a month. */
export function parsePlans(text: string): Plan[] {
  return text.split('\n').flatMap(line => {
    const match = /^\s*(.+?)\s*[=:]\s*\$?\s*(\d+(?:\.\d+)?)\s*$/.exec(line);
    return match ? [{ name: match[1]!, usd: Number(match[2]) }] : [];
  });
}

export default function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    claudeConfigDirs: { type: 'string', experimental_multiline: true, default: '',
      label: 'Extra Claude Code config directories',
      description: 'One per line, on every host. `~` and whole-segment `*` work, such as ~/.claude-profiles/*/*. '
        + 'Directories BB threads use are found on their own.' },
    plans: { type: 'string', experimental_multiline: true, default: '',
      label: 'Plans you pay for', description: 'One per line as Name = monthly US dollars, such as Claude Max = 200.' },
  });
  const host = bb.hosts.experimental_client({ contract: hostContract });
  let ledger: Ledger | undefined;
  const store = () => {
    if (ledger) return ledger;
    const db = bb.storage.database();
    bb.storage.migrate(db, migrations);
    return ledger = new Ledger(db as unknown as Database);
  };

  // Claude Code config directories seen in threads' resolved environments, by host.
  const claudeDirs = async (hostId: string) => (await bb.storage.kv.get<string[]>(`claudeDirs:${hostId}`)) ?? [];

  /** Link a thread's provider sessions to it, and learn the Claude config directory its host uses. */
  async function mapThread(thread: { id: string; title: string | null; titleFallback?: string | null; projectId: string | null;
    providerId: string; parentThreadId?: string | null; environmentHostId?: string | null }) {
    const identities = await bb.sdk.threads.events.list({ threadId: thread.id, types: ['thread/identity'], order: 'asc', limit: '100' });
    const sessions = [...new Set(identities.flatMap(event => event.type === 'thread/identity' ? [event.data.providerThreadId] : []))];
    store().mapThread({ threadId: thread.id, title: thread.title ?? thread.titleFallback ?? 'Untitled thread', projectId: thread.projectId,
      provider: thread.providerId, parentId: thread.parentThreadId ?? null }, sessions, Date.now());
    if (thread.providerId !== 'claude-code' || !thread.environmentHostId) return;
    const [resolved] = await bb.sdk.threads.events.list({ threadId: thread.id, types: ['provider.env-resolved'], order: 'desc', limit: '1' });
    const entry = resolved?.type === 'provider.env-resolved' ? resolved.data.entries.find(value => value.name === 'CLAUDE_CONFIG_DIR') : undefined;
    if (typeof entry?.value !== 'string' || !entry.value) return;
    const known = await claudeDirs(thread.environmentHostId);
    if (!known.includes(entry.value)) await bb.storage.kv.set(`claudeDirs:${thread.environmentHostId}`, [...known, entry.value]);
  }

  async function mapThreads(signal?: AbortSignal) {
    const mapped = store().mappedAt();
    for (const archived of [false, true]) for (let offset = 0; ; offset += 100) {
      const page = await bb.sdk.threads.list({ archived, includeHidden: true, limit: 100, offset, signal });
      for (const thread of page) {
        if ((mapped.get(thread.id) ?? 0) >= thread.updatedAt) continue;
        await mapThread(thread).catch(error => bb.log.warn(`Cost: mapping ${thread.id} failed: ${message(error)}`));
      }
      if (page.length < 100) break;
    }
  }

  let progress = idle();
  /**
   * Read every session log on a host changed since `since`, from each file's saved offset. Each chunk's
   * requests and the new offset commit together, so an interrupted scan resumes where it stopped.
   */
  async function scanHost(hostId: string, since: number, signal?: AbortSignal) {
    const startedAt = Date.now();
    const extra = (await settings.get()).claudeConfigDirs.split('\n').map(line => line.trim()).filter(Boolean);
    const { files } = await host.call('list', { claudeConfigDirs: [...extra, ...await claudeDirs(hostId)], since }, { hostId, timeoutMs: 300_000 });
    const cursors = store().cursors(hostId);
    const pending = files.flatMap(file => {
      const saved = cursors.get(file.path);
      // A file smaller than its cursor was replaced, so it is read again; its requests keep their keys.
      const cursor: FileCursor = saved && saved.offset <= file.size ? saved : { size: 0, offset: 0, context: {} };
      return cursor.offset < file.size ? [{ ...file, cursor }] : [];
    });
    progress.files += pending.length;
    progress.bytes += pending.reduce((sum, file) => sum + file.size - file.cursor.offset, 0);
    let changed = false;
    for (const file of pending) {
      let cursor = file.cursor;
      while (cursor.offset < file.size && !signal?.aborted) {
        const result = await host.call('read', { provider: file.provider, path: file.path, offset: cursor.offset, context: cursor.context },
          { hostId, timeoutMs: 60_000 });
        if (result.offset === cursor.offset) break;
        progress.bytesDone += result.offset - cursor.offset;
        progress.records += result.records.length;
        cursor = { size: file.size, offset: result.offset, context: result.context };
        store().ingest(hostId, file.path, { cursor, records: result.records, turns: result.turns, sessions: result.sessions });
        changed ||= result.records.length > 0;
      }
      progress.filesDone += 1;
    }
    if (!signal?.aborted) await bb.storage.kv.set(`listedAt:${hostId}`, startedAt);
    return changed;
  }

  const activeHosts = async () => (await bb.sdk.hosts.list()).filter(value => value.lifecycle.phase === 'active').map(value => value.id);

  // One scan at a time per host: live updates, the schedule and backfill share cursors.
  const queues = new Map<string, Promise<unknown>>();
  function enqueue<T>(hostId: string, task: () => Promise<T>): Promise<T> {
    const next = (queues.get(hostId) ?? Promise.resolve()).catch(() => {}).then(task);
    queues.set(hostId, next);
    void next.finally(() => { if (queues.get(hostId) === next) queues.delete(hostId); }).catch(() => {});
    return next;
  }
  /** Changes since the last scan. A host never scanned starts from the past day; older history needs a backfill. */
  const refresh = (hostId: string) => enqueue(hostId, async () => {
    const listedAt = await bb.storage.kv.get<number>(`listedAt:${hostId}`);
    // A minute of overlap: a file written during the last listing is listed again.
    if (await scanHost(hostId, (listedAt ?? Date.now() - day) - 60_000)) bb.realtime.publish('usage-changed', {});
  });

  let backfill: AbortController | null = null;
  async function startBackfill() {
    if (progress.state === 'running') return false;
    backfill = new AbortController();
    const { signal } = backfill;
    progress = { ...idle(), state: 'running', startedAt: Date.now() };
    void (async () => {
      try {
        await refreshPrices(false);
        await mapThreads(signal);
        for (const hostId of await activeHosts()) await enqueue(hostId, () => scanHost(hostId, 0, signal));
        progress = { ...progress, state: 'idle', finishedAt: Date.now() };
      } catch (error) {
        progress = { ...progress, state: 'failed', finishedAt: Date.now(), error: message(error) };
      }
      await bb.storage.kv.set('lastBackfill', progress);
      bb.realtime.publish('usage-changed', {});
    })();
    return true;
  }

  async function refreshPrices(force: boolean) {
    const saved = store().prices();
    if (!force && saved && Date.now() - saved.fetchedAt < day) return saved.fetchedAt;
    const response = await fetch(priceSourceUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Price file download failed: HTTP ${response.status}.`);
    const cards = parseLiteLlm(await response.json());
    const at = Date.now();
    store().savePrices(at, cards);
    bb.realtime.publish('usage-changed', {});
    return at;
  }

  // Live: after each turn, read what the thread's host wrote. Debounced, since idle events can arrive in bursts.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  bb.events.on('thread.idle', ({ thread }) => {
    const { environmentId } = thread;
    if (!environmentId) return;
    clearTimeout(timers.get(environmentId));
    timers.set(environmentId, setTimeout(() => {
      timers.delete(environmentId);
      bb.sdk.environments.get({ environmentId })
        .then(async ({ hostId }) => { await mapThread({ ...thread, environmentHostId: hostId }); await refresh(hostId); })
        .catch(error => bb.log.warn(`Cost: refresh after ${thread.id} failed: ${message(error)}`));
    }, 3000));
  });
  bb.events.on('thread.deleted', ({ thread }) => store().forgetThread(thread.id));
  bb.background.schedule('scan', '*/15 * * * *', async () => {
    await mapThreads();
    for (const hostId of await activeHosts()) await refresh(hostId).catch(error => bb.log.warn(`Cost: scan of ${hostId} failed: ${message(error)}`));
  });
  bb.background.schedule('prices', '17 */6 * * *', () => refreshPrices(false).then(() => {}));
  bb.background.service('startup', {
    async start(signal) {
      await refreshPrices(false).catch(error => bb.log.warn(`Cost: ${message(error)}`));
      if (!signal.aborted) await mapThreads(signal).catch(error => bb.log.warn(`Cost: mapping failed: ${message(error)}`));
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      backfill?.abort();
      for (const timer of timers.values()) clearTimeout(timer);
    },
  });

  const windowStart = (days: number) => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1); };
  /** With `group`, each sub-thread's usage counts toward the thread that started it. */
  function rowsFor(from: number, group: boolean): UsageRow[] {
    const rows = store().rowsSince(from);
    if (!group) return rows;
    const parents = store().parents();
    return rows.map(row => row.threadId ? { ...row, threadId: rootOf(parents, row.threadId) } : row);
  }

  async function summary(days: 7 | 30 | 90, group = false): Promise<SummaryView> {
    const now = new Date();
    const first = windowStart(days);
    const month = new Date(now.getFullYear(), now.getMonth(), 1);
    const prices = store().prices();
    const cards = prices?.cards ?? {};
    const view = summarise(rowsFor(first.getTime(), group), cards, localDay(first), localDay(now));
    const monthUsd = summarise(store().rowsSince(month.getTime()), cards, localDay(month), localDay(now)).total.usd;
    const info = store().threads(view.threads.flatMap(line => line.threadId ? [line.threadId] : []));
    const list = await bb.sdk.projects.list().catch(() => []);
    const projects = new Map(list.map(project => [project.id, project.name]));
    // Checkouts as shallow as a home directory would claim every terminal session, so they never match.
    const checkouts = list.flatMap(project => ('sources' in project ? project.sources : [])
      .filter(source => source.path.split('/').filter(Boolean).length > 2)
      .map(source => ({ path: source.path.replace(/\/+$/, ''), ref: { projectId: project.id, name: project.name } })))
      .sort((a, b) => b.path.length - a.path.length);
    const projectAt = (cwd: string): ProjectRef | null =>
      checkouts.find(checkout => cwd === checkout.path || cwd.startsWith(`${checkout.path}/`))?.ref ?? null;
    const projectOf = (threadId: string): ProjectRef => {
      const projectId = info.get(threadId)?.projectId ?? null;
      return projectId ? { projectId, name: projects.get(projectId) ?? 'Unknown project' } : { projectId: null, name: 'No project' };
    };
    const shown = new Set(view.threads.slice(0, 200).flatMap(line => line.threadId ? [line.threadId] : []));
    return { ...view, threads: view.threads.slice(0, 200), threadCount: view.threads.length, pricesAt: prices?.fetchedAt ?? null, firstDay: localDay(first), lastDay: localDay(now),
      threadInfo: Object.fromEntries([...info].filter(([id]) => shown.has(id)).map(([id, value]) => [id,
        { title: value.title, projectName: value.projectId ? projects.get(value.projectId) ?? null : null, provider: value.provider }])),
      projects: groupProjects(view.threads, projectOf, projectAt),
      plans: parsePlans((await settings.get()).plans), monthUsd, firstAt: store().counts().firstAt };
  }

  bb.rpc.register(rpcContract, {
    thread: async ({ threadId }) => {
      const rows = store().threadRows(threadId);
      if (!rows.length) return null;
      const prices = store().prices();
      return { ...threadCost(rows, prices?.cards ?? {}), pricesAt: prices?.fetchedAt ?? null, title: store().threads([threadId]).get(threadId)?.title ?? null };
    },
    summary: ({ days, group }) => summary(days, group),
    insights: async ({ days, group }) => {
      const from = windowStart(days).getTime();
      const cards = store().prices()?.cards ?? {};
      const lines = summarise(store().rowsSince(from), cards, localDay(windowStart(days)), localDay(new Date())).threads;
      const lengths = store().lengths(from);
      const info = store().threads(lines.flatMap(line => line.threadId ? [line.threadId] : []));
      const describe = (threadId: string) => {
        const value = info.get(threadId) ?? store().threads([threadId]).get(threadId);
        return value ? { title: value.title, provider: value.provider as Provider } : undefined;
      };
      const points: InsightPoint[] = lines.flatMap(line => {
        if (!line.threadId) return [];
        const length = lengths.get(line.threadId) ?? { requests: line.requests, turns: 0, peakContext: 0 };
        const meta = describe(line.threadId);
        return [{ threadId: line.threadId, title: meta?.title ?? 'Untitled thread', provider: meta?.provider ?? line.providers[0] ?? 'claude-code',
          usd: line.usd, ...length, subThreads: 0 }];
      });
      return { points: group ? foldThreads(points, store().parents(), describe) : points };
    },
    series: async ({ threadId }) => {
      const costs = requestCosts(store().threadRequests(threadId), store().prices()?.cards ?? {});
      return { requests: costs.length, points: downsample(costs), growth: growth(costs) };
    },
    progress: async () => progress.state === 'running' ? progress : (await bb.storage.kv.get<Progress>('lastBackfill')) ?? progress,
  });

  const json = { type: 'boolean', description: 'Print machine-readable JSON' } as const;
  const usd = (value: number) => `$${value.toFixed(2)}`;
  bb.cli.register(defineCli({
    name: 'cost',
    summary: 'API-price estimates of agent usage: backfill history, check progress, refresh prices',
    commands: {
      backfill: cliCommand({
        summary: 'Read every session log on every active host into the ledger; safe to repeat',
        options: { json },
        run: async ({ options }) => {
          const started = await startBackfill();
          const text = started ? 'Backfill started. Run `bb cost status` for progress.' : 'A backfill is already running.';
          return { exitCode: 0, stdout: options.json ? JSON.stringify({ started, progress }) : text };
        },
      }),
      status: cliCommand({
        summary: 'Show backfill progress, ledger size and price-file age',
        options: { json },
        run: async ({ options }) => {
          const current = progress.state === 'running' ? progress : (await bb.storage.kv.get<Progress>('lastBackfill')) ?? progress;
          const counts = store().counts();
          const pricesAt = store().prices()?.fetchedAt ?? null;
          const month = await summary(30);
          if (options.json) return { exitCode: 0, stdout: JSON.stringify({ progress: current, ledger: counts, pricesAt, last30DaysUsd: month.total.usd, since: month.firstDay, tzOffset: new Date().getTimezoneOffset(), unpriced: month.total.unpricedTokens }) };
          const share = current.bytes ? ` (${Math.round(current.bytesDone / current.bytes * 100)}%)` : '';
          return { exitCode: 0, stdout: [
            `Backfill: ${current.state}${share}, ${current.filesDone}/${current.files} files, ${current.records} requests read`
              + (current.error ? `, error: ${current.error}` : ''),
            `Ledger: ${counts.requests} requests in ${counts.files} files, ${counts.threads} BB threads mapped`
              + (counts.firstAt ? `, since ${new Date(counts.firstAt).toISOString().slice(0, 10)}` : ''),
            `Prices: ${pricesAt ? `fetched ${new Date(pricesAt).toISOString()}` : 'not fetched'}`,
            `Last 30 days: ${usd(month.total.usd)} at API prices`,
          ].join('\n') };
        },
      }),
      prices: cliCommand({
        summary: 'Download the LiteLLM price file now',
        options: { json },
        run: async ({ options }) => {
          const at = await refreshPrices(true);
          return { exitCode: 0, stdout: options.json ? JSON.stringify({ pricesAt: at }) : `Prices fetched ${new Date(at).toISOString()}.` };
        },
      }),
    },
  }));
}
