import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, experimental_Icon as Icon, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { Chip, ChipDot, ChipValue } from '@bb-plugins/chip';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import { expiresAt, hitRatio, type CacheState } from './src/cache.ts';
import { clock, countdown, gap, lifetime, missReason, percent, staleNote, tokens } from './src/format.ts';
import { CachePopover, warmth } from './popover.tsx';
import './app.css';

function describe(state: CacheState, now: number, stale: number | null) {
  const lines: string[] = [];
  if (stale !== null) lines.push(staleNote(stale));
  const expiry = expiresAt(state);
  const rebuild = tokens(state.last?.prompt ?? 0);
  if (expiry !== null && state.ttlMs !== null) lines.push(expiry > now
    ? `Cache expires in ${clock(Math.min(expiry - now, state.ttlMs))} (${lifetime(state.ttlMs)} lifetime)`
    : expiry === state.invalidatedAt ? `Claude account switched; the next request rebuilds ${rebuild}`
    : `Cache expired ${gap(now - expiry)} ago; the next request rebuilds ${rebuild}`);
  if (state.last) lines.push(`Last request: ${percent(hitRatio(state.last.read, state.last.prompt) ?? 0)} cached `
    + `(read ${tokens(state.last.read)}, wrote ${tokens(state.last.write)} of ${tokens(state.last.prompt)})`);
  const thread = hitRatio(state.read, state.prompt);
  if (thread !== null) lines.push(`Thread: ${percent(thread)} cached`);
  if (state.lastMiss) lines.push(`${state.misses} miss${state.misses === 1 ? '' : 'es'}, ${tokens(state.missedTokens)} re-sent; `
    + `last ${tokens(state.lastMiss.tokens)}, ${missReason(state.lastMiss)}`);
  return lines.join('\n');
}

/** Waits before each retry of a failed `thread` call; after the last, the next `cache-changed` loads again. */
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000];

function CacheChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<CacheState | null>(null);
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  // When the newest call failed: the time of the last reply shown, so the chip and popover say how old their figures are.
  const [stale, setStale] = useState<number | null>(null);
  const updated = useRef(0);
  // The clicked button, so focus and placement follow the chip in this pane even when a split shows the same thread.
  const chip = useRef<HTMLButtonElement | null>(null);
  // Calls are numbered. A reply sets state only when its call is newer than the one on screen, so a slow
  // reply never overwrites a newer one, yet still lands when a newer call failed. A thread switch or unmount
  // moves both counters past every call made so far, so replies for the old thread are dropped. A failed call
  // keeps the last state on screen and, while it is the newest, tries again: each call follows a change on
  // the server, so the kept state is out of date until one succeeds, and the chip marks it stale meanwhile.
  const latest = useRef(0);
  const shown = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const load = useCallback(() => {
    clearTimeout(retry.current);
    const call = ++latest.current;
    const attempt = (failures: number) => rpc.call('thread', { threadId }).then(next => {
      if (call <= shown.current) return;
      const at = Date.now();
      shown.current = call; updated.current = at; setState(next);
      // An older reply that lands while the newest call has failed is still behind that call.
      setStale(old => call === latest.current || old === null ? null : at);
    }, () => {
      if (call !== latest.current) return;
      setStale(updated.current);
      if (failures < RETRY_DELAYS_MS.length) retry.current = setTimeout(() => attempt(failures + 1), RETRY_DELAYS_MS[failures]);
    });
    void attempt(0);
  }, [rpc, threadId]);
  useEffect(() => {
    setState(null); setOpen(false); setStale(null); load();
    return () => { clearTimeout(retry.current); shown.current = ++latest.current; };
  }, [load]);
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
  if (!state || !view) {
    // A chip hidden by compaction must not reopen its popover when the next request brings it back.
    if (open) setOpen(false);
    return null;
  }
  const summary = describe(state, now, stale);
  // Codex reports no lifetime, so its value is the hit rate; Claude's is the time left, never above the lifetime.
  const value = view.left === null ? percent(view.ratio) : view.left <= 0 ? 'cold' : countdown(Math.min(expiry! - now, state.ttlMs!));
  return <>
    <Chip className="cache-hits" icon={<Icon name="cache-hits/timer" />} expanded={open} aria-label={`Prompt cache ${value}. ${summary}`} title={summary}
      data-stale={stale !== null || undefined}
      onClick={event => { chip.current = event.currentTarget; setOpen(!open); }}>
      {!isCompactViewport && <ChipValue>{value}</ChipValue>}
      <ChipDot tone={view.level} className={view.left !== null && view.left <= 0 ? 'ch-cold' : undefined}>{state.misses > 0 ? state.misses : null}</ChipDot>
    </Chip>
    {open && <CachePopover state={state} now={now} view={view} stale={stale} trigger={() => chip.current} onClose={() => setOpen(false)} />}
  </>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'cache-hits', title: 'Prompt cache', component: CacheChip });
});
