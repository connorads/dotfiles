import { useCallback, useEffect, useState } from 'react';
import { definePluginApp, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { hitRatio, type CacheState } from './src/cache.ts';
import './app.css';

function tokens(value: number) {
  if (value < 1000) return String(value);
  return value < 10000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value / 1000)}k`;
}
const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

function describe(state: CacheState) {
  const unit = state.granularity === 'turn' ? 'turn' : 'request';
  const lines: string[] = [];
  if (state.last) lines.push(`Last ${unit}: ${percent(hitRatio(state.last.read, state.last.prompt) ?? 0)} cached `
    + `(read ${tokens(state.last.read)}, wrote ${tokens(state.last.write)} of ${tokens(state.last.prompt)})`);
  const session = hitRatio(state.read, state.prompt);
  if (session !== null) lines.push(`Thread: ${percent(session)} cached`);
  if (state.lastMiss) {
    const idle = state.lastMiss.idleMs === null ? '' : ` after ${Math.round(state.lastMiss.idleMs / 60_000)}m`;
    lines.push(`${state.misses} miss${state.misses === 1 ? '' : 'es'}, ${tokens(state.missedTokens)} re-sent; last ${tokens(state.lastMiss.tokens)}${idle}`);
  }
  return lines.join('\n');
}

function CacheChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<CacheState | null>(null);
  const load = useCallback(() => { rpc.call('thread', { threadId }).then(setState, () => setState(null)); }, [rpc, threadId]);
  useEffect(() => { setState(null); load(); }, [load]);
  useRealtime('cache-changed', (payload: unknown) => {
    if ((payload as { threadId?: unknown } | null)?.threadId === threadId) load();
  });
  const ratio = state?.last ? hitRatio(state.last.read, state.last.prompt) : null;
  if (!state || ratio === null) return null;
  const level = ratio >= 0.8 ? 'ok' : ratio >= 0.5 ? 'warn' : 'high';
  const summary = describe(state);
  return <span className="cache-hits" role="status" aria-label={`Prompt cache. ${summary}`} title={summary}>
    <span className="ch-dot" data-level={level} />
    {!isCompactViewport && <span className="ch-muted">cache</span>}
    <span>{percent(ratio)}</span>
    {state.misses > 0 && <span className="ch-miss">{state.misses} miss</span>}
  </span>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'cache-hits', title: 'Prompt cache', component: CacheChip });
});
