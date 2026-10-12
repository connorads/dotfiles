import { useCallback, useEffect, useState } from 'react';
import { definePluginApp, experimental_Icon as Icon, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { ChipDot, ChipValue } from '@bb-plugins/chip';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { expiresAt, hitRatio, type CacheState } from './src/cache.ts';
import './app.css';

function tokens(value: number) {
  if (value < 1000) return String(value);
  return value < 10000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value / 1000)}k`;
}
const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;
function clock(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60];
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
}
/** Whole minutes while there is time; seconds only in the last two minutes. */
const countdown = (ms: number) => ms >= 120_000 ? `${Math.floor(ms / 60_000)}m` : clock(ms);
const lifetime = (ms: number) => ms >= 3_600_000 ? `${ms / 3_600_000}h` : `${ms / 60_000}m`;

function describe(state: CacheState, now: number) {
  const lines: string[] = [];
  const expiry = expiresAt(state);
  const rebuild = tokens(state.last?.prompt ?? 0);
  if (expiry !== null && state.ttlMs !== null) lines.push(expiry > now
    ? `Cache expires in ${clock(expiry - now)} (${lifetime(state.ttlMs)} lifetime)`
    : expiry === state.invalidatedAt ? `Claude account switched; the next request rebuilds ${rebuild}`
    : `Cache expired ${Math.round((now - expiry) / 60_000)}m ago; the next request rebuilds ${rebuild}`);
  if (state.last) lines.push(`Last request: ${percent(hitRatio(state.last.read, state.last.prompt) ?? 0)} cached `
    + `(read ${tokens(state.last.read)}, wrote ${tokens(state.last.write)} of ${tokens(state.last.prompt)})`);
  const thread = hitRatio(state.read, state.prompt);
  if (thread !== null) lines.push(`Thread: ${percent(thread)} cached`);
  if (state.lastMiss) lines.push(`${state.misses} miss${state.misses === 1 ? '' : 'es'}, ${tokens(state.missedTokens)} re-sent; `
    + `last ${tokens(state.lastMiss.tokens)} after ${state.lastMiss.cause === 'account' ? 'account switch' : `${Math.round(state.lastMiss.idleMs / 60_000)}m`}`);
  return lines.join('\n');
}

function CacheChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<CacheState | null>(null);
  const [now, setNow] = useState(Date.now);
  const load = useCallback(() => { rpc.call('thread', { threadId }).then(setState, () => setState(null)); }, [rpc, threadId]);
  useEffect(() => { setState(null); load(); }, [load]);
  useRealtime('cache-changed', (payload: unknown) => {
    if ((payload as { threadId?: unknown } | null)?.threadId === threadId) load();
  });
  const expiry = state ? expiresAt(state) : null;
  useEffect(() => {
    if (expiry === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiry]);
  const ratio = state?.last ? hitRatio(state.last.read, state.last.prompt) : null;
  if (!state || ratio === null) return null;
  // The dot shows cache warmth when the provider reports a lifetime, otherwise the last hit rate.
  const left = expiry === null || state.ttlMs === null ? null : (expiry - now) / state.ttlMs;
  const [fraction, ok, warn] = left === null ? [ratio, 0.8, 0.5] : [left, 0.5, 0.2];
  const level = fraction > ok ? 'ok' : fraction > warn ? 'warn' : 'danger';
  const summary = describe(state, now);
  // Codex reports no lifetime, so its value is the hit rate; Claude's is the time left.
  const value = left === null ? percent(ratio) : left <= 0 ? 'cold' : countdown(expiry! - now);
  return <span className="bbp-chip cache-hits" role="status" aria-label={`Prompt cache. ${summary}`} title={summary}>
    <span className="bbp-chip-icon" aria-hidden="true"><Icon name="Zap" /></span>
    {!isCompactViewport && <ChipValue>{value}</ChipValue>}
    <ChipDot tone={level} className={left !== null && left <= 0 ? 'ch-cold' : undefined}>{state.misses > 0 ? state.misses : null}</ChipDot>
  </span>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'cache-hits', title: 'Prompt cache', component: CacheChip });
});
