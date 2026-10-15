import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, experimental_Icon as Icon, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { Chip, ChipDot, ChipValue } from '@bb-plugins/chip';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { expiresAt, hitRatio, type CacheState } from './src/cache.ts';
import { clock, countdown, lifetime, missReason, percent, tokens } from './src/format.ts';
import { CachePopover, warmth } from './popover.tsx';
import './app.css';

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
    + `last ${tokens(state.lastMiss.tokens)}, ${missReason(state.lastMiss)}`);
  return lines.join('\n');
}

function CacheChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<CacheState | null>(null);
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  // The clicked button, so focus and placement follow the chip in this pane even when a split shows the same thread.
  const chip = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(() => { rpc.call('thread', { threadId }).then(setState, () => setState(null)); }, [rpc, threadId]);
  useEffect(() => { setState(null); setOpen(false); load(); }, [load]);
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
  const view = state && warmth(state, now);
  if (!state || !view) return null;
  const summary = describe(state, now);
  // Codex reports no lifetime, so its value is the hit rate; Claude's is the time left.
  const value = view.left === null ? percent(view.ratio) : view.left <= 0 ? 'cold' : countdown(expiry! - now);
  return <>
    <Chip className="cache-hits" icon={<Icon name="Zap" />} expanded={open} aria-label={`Prompt cache. ${summary}`} title={summary}
      onClick={event => { chip.current = event.currentTarget; setOpen(!open); }}>
      {!isCompactViewport && <ChipValue>{value}</ChipValue>}
      <ChipDot tone={view.level} className={view.left !== null && view.left <= 0 ? 'ch-cold' : undefined}>{state.misses > 0 ? state.misses : null}</ChipDot>
    </Chip>
    {open && <CachePopover state={state} now={now} view={view} trigger={() => chip.current} onClose={() => setOpen(false)} />}
  </>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'cache-hits', title: 'Prompt cache', component: CacheChip });
});
