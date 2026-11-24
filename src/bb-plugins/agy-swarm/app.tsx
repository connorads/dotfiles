import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  definePluginApp,
  experimental_CollapsibleStackCard as CollapsibleStackCard,
  experimental_Icon as Icon,
  experimental_useAppPanel as useAppPanel,
  useComposer,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi, PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type {
  BoardMessage,
  MemberState,
  SwarmMember,
  SwarmSnapshot,
  WorkerLogResult,
  rpcContract,
} from './contracts.ts';
import {
  cleanBoardPreview,
  formatRelativeTime,
  groupWorkerSteps,
  type GroupedWorkerStep,
  type PairedToolCall,
} from './src/format.ts';
import {
  AnimatedNumber,
  CountSuffix,
  DisclosureChevron,
  PhaseIndicator,
  RefreshIcon,
  SegmentedControl,
  TextShimmer,
} from './ui/primitives.tsx';
import './app.css';

type Rpc = PluginRpcClient<typeof rpcContract>;
type ViewTab = 'overview' | 'board' | 'workers';

const swarmTabRef = { id: 'swarm', context: { kind: 'thread' as const }, availability: 'action' as const };
const activePollMs = 2_000;
const idlePollMs = 6_000;

/* -------------------------------------------------------------------------- */
/* Banner -> Panel Navigation Bus (same-bundle jump to tab / worker)          */
/* -------------------------------------------------------------------------- */

interface PanelNavigationIntent {
  tab: ViewTab;
  member?: string;
}

type NavigationListener = (intent: PanelNavigationIntent) => void;

const pendingIntents = new Map<string, PanelNavigationIntent>();
const intentListeners = new Map<string, Set<NavigationListener>>();

function dispatchPanelIntent(threadId: string, intent: PanelNavigationIntent) {
  const listeners = intentListeners.get(threadId);
  if (listeners && listeners.size > 0) {
    for (const fn of listeners) fn(intent);
  } else {
    pendingIntents.set(threadId, intent);
  }
}

function subscribePanelIntent(threadId: string, listener: NavigationListener): () => void {
  const pending = pendingIntents.get(threadId);
  if (pending) {
    pendingIntents.delete(threadId);
    listener(pending);
  }
  let set = intentListeners.get(threadId);
  if (!set) {
    set = new Set();
    intentListeners.set(threadId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) intentListeners.delete(threadId);
  };
}

function isAntigravityProviderId(providerId: string | null | undefined): boolean {
  if (!providerId) return false;
  return providerId === 'acp-antigravity' || /^acp-antigravity-profile-[a-z][a-z0-9-]{0,31}$/u.test(providerId);
}

function insertSwarmPrefix(composer: PluginComposerApi) {
  const current = composer.text;
  if (!/^\s*\/swarm\b/iu.test(current)) {
    const trimmed = current.trimStart();
    const next = trimmed ? `/swarm ${trimmed}` : '/swarm ';
    composer.replace({ text: next, mentions: [] });
  }
  composer.focus();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatShortTime(value: string | null): string {
  if (!value) return '';
  const match = value.match(/\d{2}:\d{2}(?::\d{2})?/u);
  return match ? match[0] : value;
}

/** Compact human model label: "gemini-4-neon-high" -> "Neon · High". */
function formatModel(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^gemini-/iu, '').replace(/^claude-/iu, '');
  const parts = cleaned.split('-').filter(Boolean);
  if (parts.length === 0) return raw;
  const last = parts.at(-1)?.toLowerCase();
  const levels = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
  if (last && levels.has(last) && parts.length > 1) {
    const name = parts.slice(0, -1).map(s => s[0]!.toUpperCase() + s.slice(1)).join(' ');
    const effort = last === 'xhigh' ? 'XHigh' : last[0]!.toUpperCase() + last.slice(1);
    return `${name} · ${effort}`;
  }
  return parts.map(s => s[0]!.toUpperCase() + s.slice(1)).join(' ');
}

function formatStepLabel(type: string, source: string): string {
  if (type === 'PLANNER_RESPONSE') return 'Planner';
  if (type === 'GENERIC') return 'Tool output';
  if (type === 'SYSTEM_MESSAGE') return 'System';
  if (type === 'ERROR') return 'Error';
  return source === 'SYSTEM' ? 'System' : type.toLowerCase().replaceAll('_', ' ');
}

function formatMemberStateLabel(state: MemberState): string {
  switch (state) {
    case 'working': return 'Working';
    case 'waiting': return 'Waiting';
    case 'blocked': return 'Blocked';
    case 'done': return 'Done';
    case 'killed': return 'Stopped';
    case 'error': return 'Error';
  }
}

function formatTokens(input: number | null, output: number | null): string | null {
  if (input === null && output === null) return null;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  if (input !== null && output !== null) return `${k(input)} in · ${k(output)} out`;
  return input !== null ? `${k(input)} in` : `${k(output!)} out`;
}

function formatBannerStatus(snapshot: Extract<SwarmSnapshot, { kind: 'swarm' }>): string {
  const { totalWorkers, workingWorkers, doneWorkers, blockedWorkers, errorWorkers, status } = snapshot.summary;
  if (totalWorkers === 0) return `${snapshot.boardHead} posts`;
  const parts: string[] = [];
  if (status === 'stopped') {
    parts.push('Stopped');
    parts.push(`${doneWorkers}/${totalWorkers} done`);
  } else {
    parts.push(`${doneWorkers}/${totalWorkers} done`);
    if (workingWorkers > 0) parts.push(`${workingWorkers} working`);
    if (blockedWorkers > 0) parts.push(`${blockedWorkers} blocked`);
    if (errorWorkers > 0) parts.push(`${errorWorkers} error`);
  }
  return parts.join(' · ');
}

/** Clean inline formatting for board posts: strips leading [done]/[stall] markers, highlights @mentions & `code`. */
function renderBoardText(raw: string) {
  const cleaned = raw.replace(/(?:^|\s)\[(?:done|stall)\]\s*/giu, m => (m.startsWith(' ') ? ' ' : ''));
  const tokens = cleaned.split(/(`[^`\n]+`|@[a-z0-9][a-z0-9_-]{0,31})/giu);
  return tokens.map((tok, idx) => {
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) {
      return <code key={idx} className="agys-inline-code">{tok.slice(1, -1)}</code>;
    }
    if (tok.startsWith('@')) {
      return <span key={idx} className="agys-mention">{tok}</span>;
    }
    return <Fragment key={idx}>{tok}</Fragment>;
  });
}

function useNowMs(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function useSwarmSnapshot(threadId: string, enabled: boolean) {
  const rpc: Rpc = useRpc<typeof rpcContract>();
  const [snapshot, setSnapshot] = useState<SwarmSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const printed = useRef<string | null>(null);
  const seq = useRef(0);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const token = ++seq.current;
    setLoading(true);
    try {
      const fp = await rpc.call('fingerprint', { threadId });
      const snap = await rpc.call('snapshot', { threadId });
      if (token !== seq.current) return;
      printed.current = fp;
      setSnapshot(snap);
      setError(null);
    } catch (cause) {
      if (token === seq.current) {
        setError(messageOf(cause));
        printed.current = null;
      }
    } finally {
      if (token === seq.current) setLoading(false);
    }
  }, [enabled, rpc, threadId]);

  useEffect(() => {
    printed.current = null;
    setSnapshot(null);
    setError(null);
    if (enabled) void reload();
  }, [enabled, reload, threadId]);

  const isActive = snapshot?.kind === 'swarm' && snapshot.summary.active;

  useEffect(() => {
    if (!enabled) return;
    const interval = isActive ? activePollMs : idlePollMs;
    const id = window.setInterval(async () => {
      if (document.hidden || busy.current) return;
      busy.current = true;
      try {
        const fp = await rpc.call('fingerprint', { threadId });
        if (fp !== printed.current) await reload();
      } catch {
        // Keep last good snapshot on transient poll errors.
      } finally {
        busy.current = false;
      }
    }, interval);
    return () => window.clearInterval(id);
  }, [enabled, isActive, reload, rpc, threadId]);

  return { snapshot, error, loading, reload };
}

function MemberRow({
  member,
  task,
  nowMs,
  onInspect,
}: {
  member: SwarmMember;
  task?: string;
  nowMs: number;
  onInspect: (name: string) => void;
}) {
  const model = formatModel(member.model);
  const activity = member.activity ?? (member.state === 'waiting' ? 'Waiting for @mentions' : 'Idle');
  const recency = formatRelativeTime(member.lastActiveAt, nowMs);
  return (
    <button
      type="button"
      className="agys-row"
      data-state={member.state}
      onClick={() => onInspect(member.name)}
    >
      <span className="agys-row-mark">
        <PhaseIndicator state={member.state} />
      </span>
      <div className="agys-row-main">
        <div className="agys-row-line">
          <span className="agys-name">@{member.name}</span>
          {member.state === 'blocked' && <span className="agys-tag" data-tone="blocked">blocked</span>}
          {member.state === 'error' && <span className="agys-tag" data-tone="error">error</span>}
          {member.role !== 'worker' && <span className="agys-tag">{member.role}</span>}
          {member.workspaceMode !== 'inherit' && <span className="agys-tag">{member.workspaceMode}</span>}
          {model && <span className="agys-model">{model}</span>}
        </div>
        {task && <div className="agys-row-task">{task}</div>}
        <div className="agys-row-activity">
          <TextShimmer text={activity} active={member.state === 'working'} />
        </div>
      </div>
      <div className="agys-row-aside">
        {member.unreadCount > 0 && <span className="agys-tag" data-tone="working">{member.unreadCount} new</span>}
        {recency && <span className="agys-row-time">{recency}</span>}
        {member.stepCount > 0 && (
          <span>
            <AnimatedNumber value={member.stepCount} />{' '}
            <CountSuffix count={member.stepCount} singular="step" plural="steps" />
          </span>
        )}
        <span className="agys-row-chevron" aria-hidden="true">›</span>
      </div>
    </button>
  );
}

function OverviewView({
  snapshot,
  nowMs,
  onInspectWorker,
}: {
  snapshot: Extract<SwarmSnapshot, { kind: 'swarm' }>;
  nowMs: number;
  onInspectWorker: (name: string) => void;
}) {
  const byName = useMemo(() => new Map(snapshot.members.map(m => [m.name, m])), [snapshot.members]);
  const assigned = new Set<string>();
  const threads = snapshot.plan?.threads ?? [];
  for (const t of threads) {
    for (const owner of t.tasks) assigned.add(owner);
  }
  const unassigned = snapshot.members.filter(m => !assigned.has(m.name));

  return (
    <div>
      {threads.map(thread => (
        <section key={thread.id} className="agys-group">
          <div className="agys-group-head">
            <h4 className="agys-group-title">{thread.title}</h4>
          </div>
          {thread.goal && <p className="agys-group-goal">{thread.goal}</p>}
          {thread.tasks.map(name => {
            const member = byName.get(name);
            if (!member) return null;
            return (
              <MemberRow
                key={name}
                member={member}
                task={snapshot.plan?.tasks[name]}
                nowMs={nowMs}
                onInspect={onInspectWorker}
              />
            );
          })}
        </section>
      ))}

      {unassigned.length > 0 && (
        <section className="agys-group">
          <div className="agys-group-head">
            <h4 className="agys-group-title">{threads.length > 0 ? 'Coordination' : 'Roster'}</h4>
          </div>
          {unassigned.map(member => (
            <MemberRow
              key={member.name}
              member={member}
              task={snapshot.plan?.tasks[member.name]}
              nowMs={nowMs}
              onInspect={onInspectWorker}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function BoardView({
  messages,
  channels,
  members,
  scrollRef,
}: {
  messages: BoardMessage[];
  channels: string[];
  members: SwarmMember[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [channel, setChannel] = useState<string>('all');
  const [pinned, setPinned] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(messages.length);
  const roles = useMemo(() => new Map(members.map(m => [m.name, m.role])), [members]);

  const filtered = useMemo(
    () => (channel === 'all' ? messages : messages.filter(m => m.channel === channel)),
    [channel, messages],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      setPinned(nearBottom);
      if (nearBottom) setUnseen(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    const delta = filtered.length - lastCount.current;
    lastCount.current = filtered.length;
    if (delta > 0) {
      if (pinned && el) {
        requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
      } else {
        setUnseen(n => n + delta);
      }
    }
  }, [filtered.length, pinned, scrollRef]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setPinned(true);
    setUnseen(0);
  };

  return (
    <>
      {channels.length > 1 && (
        <div className="agys-filter-strip" role="group" aria-label="Swarm channels">
          <button type="button" className="agys-chip" aria-pressed={channel === 'all'} onClick={() => setChannel('all')}>
            all
          </button>
          {channels.map(ch => (
            <button key={ch} type="button" className="agys-chip" aria-pressed={channel === ch} onClick={() => setChannel(ch)}>
              #{ch}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="agys-empty">
          <p className="agys-empty-desc">No board posts yet.</p>
        </div>
      ) : (
        <div className="agys-stream">
          {filtered.map(msg => (
            <article key={`${msg.seq}:${msg.agent}`} className="agys-post">
              <div className="agys-post-head">
                <span className="agys-seq">#{msg.seq}</span>
                <span className="agys-post-author" data-role={roles.get(msg.agent)}>@{msg.agent}</span>
                {msg.channel !== 'main' && <span className="agys-tag">#{msg.channel}</span>}
                {msg.kind === 'brief' && <span className="agys-tag">brief</span>}
                {msg.isDone && <span className="agys-tag" data-tone="done">done</span>}
                {msg.isStall && <span className="agys-tag" data-tone="blocked">stall</span>}
                {msg.time && <span className="agys-post-time">{formatShortTime(msg.time)}</span>}
              </div>
              <div className="agys-post-body">{renderBoardText(msg.text)}</div>
            </article>
          ))}
        </div>
      )}

      {unseen > 0 && (
        <button type="button" className="agys-jump-pill" onClick={jumpToLatest}>
          <span>↓</span>
          <AnimatedNumber value={unseen} />{' '}
          <CountSuffix count={unseen} singular="new post" plural="new posts" />
        </button>
      )}
    </>
  );
}

function PairedToolRow({ call }: { call: PairedToolCall }) {
  const result = call.result;
  const hasOutput = Boolean(result?.text);
  const failed = Boolean(result?.failed);

  if (!result) {
    return (
      <div className="agys-tool-row">
        <span className="agys-tool-name">{call.name}</span>
        {call.argsPreview && <span className="agys-tool-args">{call.argsPreview}</span>}
      </div>
    );
  }

  if (!hasOutput) {
    return (
      <div className="agys-tool-row" data-failed={failed ? 'true' : undefined}>
        <span className="agys-tool-name">{call.name}</span>
        {call.argsPreview && <span className="agys-tool-args">{call.argsPreview}</span>}
        {failed && <span className="agys-tag" data-tone="error">error</span>}
      </div>
    );
  }

  return (
    <details className="agys-tool-details" open={failed} data-failed={failed ? 'true' : undefined}>
      <summary className="agys-tool-summary">
        <DisclosureChevron />
        <span className="agys-tool-name">{call.name}</span>
        {call.argsPreview && <span className="agys-tool-args">{call.argsPreview}</span>}
        <span className="agys-tool-meta">
          {failed ? (
            <span className="agys-tag" data-tone="error">error</span>
          ) : (
            <span>{result.text!.length} chars</span>
          )}
        </span>
      </summary>
      <div className="agys-tool-output">{result.text}</div>
    </details>
  );
}

function StepRow({ step }: { step: GroupedWorkerStep }) {
  const tokens = formatTokens(step.inputTokens, step.outputTokens);
  const label = formatStepLabel(step.type, step.source);
  const hasFailedTool = step.toolCalls.some(c => c.result?.failed);

  return (
    <div className="agys-step" data-failed={step.failed || hasFailedTool ? 'true' : undefined}>
      <div className="agys-step-head">
        <span className="agys-seq">#{step.stepIndex}</span>
        <span className="agys-step-type">{label}</span>
        {step.failed && <span className="agys-tag" data-tone="error">{step.status.toLowerCase()}</span>}
        {step.time && <span>{formatShortTime(step.time)}</span>}
        {tokens && <span className="agys-step-tokens">{tokens}</span>}
      </div>

      {step.thinking && (
        <details className="agys-step-details">
          <summary>
            <DisclosureChevron />
            <span>Thinking</span>
            <span className="agys-summary-meta">{step.thinking.length} chars</span>
          </summary>
          <div className="agys-step-text">{step.thinking}</div>
        </details>
      )}

      {step.toolCalls.length > 0 && (
        <div className="agys-tool-list">
          {step.toolCalls.map((call, idx) => (
            <PairedToolRow key={`${step.stepIndex}:${idx}`} call={call} />
          ))}
        </div>
      )}

      {step.text && (
        step.type === 'GENERIC' && step.text.length > 140 ? (
          <details className="agys-step-details" open={step.failed}>
            <summary>
              <DisclosureChevron />
              <span>Output</span>
              <span className="agys-summary-meta">{step.text.length} chars</span>
            </summary>
            <div className="agys-step-text">{step.text}</div>
          </details>
        ) : (
          <div className="agys-step-text">{step.text}</div>
        )
      )}
    </div>
  );
}

function WorkersView({
  threadId,
  members,
  tasks,
  selected,
  nowMs,
  onSelect,
  refreshKey,
}: {
  threadId: string;
  members: SwarmMember[];
  tasks: Record<string, string>;
  selected: string | null;
  nowMs: number;
  onSelect: (name: string) => void;
  refreshKey: string;
}) {
  const rpc: Rpc = useRpc<typeof rpcContract>();
  const activeMemberObj = useMemo(() => {
    if (selected) {
      const found = members.find(m => m.name === selected);
      if (found) return found;
    }
    return members.find(m => m.state === 'blocked' || m.state === 'error')
      ?? members.find(m => m.state === 'working')
      ?? members.find(m => m.role === 'worker')
      ?? members[0]
      ?? null;
  }, [members, selected]);
  const activeMember = activeMemberObj?.name ?? null;

  const [log, setLog] = useState<WorkerLogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => {
    if (!activeMember) return;
    let cancelled = false;
    setLoading(true);
    void rpc.call('workerLog', { threadId, member: activeMember }).then(res => {
      if (!cancelled) setLog(res);
    }).catch(cause => {
      if (!cancelled) setLog({ ok: false, reason: messageOf(cause) });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeMember, refreshKey, rpc, threadId]);

  const groupedSteps = useMemo(() => {
    if (!log || !log.ok) return [];
    return groupWorkerSteps(log.steps, showSystem);
  }, [log, showSystem]);

  if (!activeMember || !activeMemberObj) {
    return (
      <div className="agys-empty">
        <p className="agys-empty-desc">No members in this swarm yet.</p>
      </div>
    );
  }

  const assignedTask = tasks[activeMember];
  const model = formatModel(activeMemberObj.model);
  const recency = formatRelativeTime(activeMemberObj.lastActiveAt, nowMs);

  return (
    <div>
      <div className="agys-worker-bar" role="group" aria-label="Select swarm member">
        {members.map(m => (
          <button
            key={m.name}
            type="button"
            className="agys-worker-pill"
            data-state={m.state}
            aria-pressed={m.name === activeMember}
            onClick={() => onSelect(m.name)}
          >
            <PhaseIndicator state={m.state} />
            <span>@{m.name}</span>
          </button>
        ))}
      </div>

      <div className="agys-worker-context">
        <div className="agys-worker-context-top">
          <span className="agys-worker-state" data-state={activeMemberObj.state}>
            {formatMemberStateLabel(activeMemberObj.state)}
          </span>
          {activeMemberObj.role !== 'worker' && <span className="agys-tag">{activeMemberObj.role}</span>}
          {activeMemberObj.workspaceMode !== 'inherit' && <span className="agys-tag">{activeMemberObj.workspaceMode}</span>}
          {model && <span className="agys-model">{model}</span>}
          {recency && <span className="agys-worker-recency">{recency}</span>}
        </div>
        {assignedTask && <p className="agys-worker-task">{assignedTask}</p>}
      </div>

      {log && log.ok && (
        <div className="agys-worker-subbar">
          <span>
            <AnimatedNumber value={groupedSteps.length} />{' '}
            <CountSuffix count={groupedSteps.length} singular="turn" plural="turns" />
            {' · '}
            <AnimatedNumber value={log.totalSteps} />{' '}
            <CountSuffix count={log.totalSteps} singular="step" plural="steps" />
          </span>
          <button
            type="button"
            className="agys-toggle-sys"
            aria-pressed={showSystem}
            onClick={() => setShowSystem(v => !v)}
          >
            {showSystem ? 'Hide system' : 'Show system'}
          </button>
        </div>
      )}

      {loading && !log && (
        <div className="agys-empty"><p className="agys-empty-desc">Loading transcript…</p></div>
      )}
      {log && !log.ok && <p className="agys-alert">{log.reason}</p>}
      {log && log.ok && groupedSteps.length === 0 && (
        <div className="agys-empty">
          <p className="agys-empty-desc">No activity steps recorded for @{log.member} yet.</p>
        </div>
      )}
      {groupedSteps.map(step => <StepRow key={step.stepIndex} step={step} />)}
    </div>
  );
}

function SwarmPanel({ threadId }: { threadId: string }) {
  const composer = useComposer();
  const [tab, setTab] = useState<ViewTab>('overview');
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowMs = useNowMs(15_000);
  const { snapshot, error, loading, reload } = useSwarmSnapshot(threadId, true);

  useEffect(() => subscribePanelIntent(threadId, intent => {
    setTab(intent.tab);
    if (intent.member) setSelectedWorker(intent.member);
  }), [threadId]);

  const inspectWorker = useCallback((name: string) => {
    setSelectedWorker(name);
    setTab('workers');
  }, []);

  const refreshKey = snapshot?.kind === 'swarm'
    ? `${snapshot.boardHead}:${snapshot.members.map(m => `${m.name}:${m.stepCount}:${m.state}`).join(',')}`
    : '';

  const segItems = useMemo(() => [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'board' as const, label: 'Board', ...(snapshot?.kind === 'swarm' ? { count: snapshot.boardHead } : {}) },
    { id: 'workers' as const, label: 'Workers', ...(snapshot?.kind === 'swarm' ? { count: snapshot.members.length } : {}) },
  ], [snapshot]);

  const progressRatio = snapshot?.kind === 'swarm' && snapshot.summary.totalWorkers > 0
    ? snapshot.summary.doneWorkers / snapshot.summary.totalWorkers
    : 0;

  const lastActivityLabel = snapshot?.kind === 'swarm'
    ? formatRelativeTime(snapshot.summary.lastActivityAt, nowMs)
    : null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '1') setTab('overview');
    else if (e.key === '2') setTab('board');
    else if (e.key === '3') setTab('workers');
    else if (e.key === 'r') void reload();
  };

  return (
    <div className="agys-panel" tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="agys-head" data-refreshing={loading ? 'true' : undefined}>
        {snapshot?.kind === 'swarm' && (
          <div className="agys-head-top">
            <div className="agys-head-titles">
              <h3 className="agys-title">{snapshot.title ?? snapshot.plan?.goalTitle ?? 'Antigravity Swarm'}</h3>
              {snapshot.plan?.goalLine && <p className="agys-subtitle">{snapshot.plan.goalLine}</p>}
            </div>
            <div className="agys-head-right">
              {snapshot.summary.status === 'stopped' && (
                <span className="agys-tag">stopped</span>
              )}
              {snapshot.summary.blockedWorkers > 0 && (
                <span className="agys-tag" data-tone="blocked">{snapshot.summary.blockedWorkers} blocked</span>
              )}
              {snapshot.summary.errorWorkers > 0 && (
                <span className="agys-tag" data-tone="error">{snapshot.summary.errorWorkers} err</span>
              )}
              {snapshot.summary.totalWorkers > 0 && (
                <span className="agys-stat-summary">
                  <strong><AnimatedNumber value={snapshot.summary.doneWorkers} /></strong>
                  <span>/</span>
                  <AnimatedNumber value={snapshot.summary.totalWorkers} />
                  <span>done</span>
                </span>
              )}
              <PhaseIndicator state={snapshot.summary.status} />
            </div>
          </div>
        )}

        <div className="agys-head-bar">
          <SegmentedControl
            items={segItems}
            value={tab}
            onChange={setTab}
            ariaLabel="Swarm board sections"
          />
          <div className="agys-head-actions">
            {lastActivityLabel && <span className="agys-head-recency">{lastActivityLabel}</span>}
            <button
              type="button"
              className="agys-ghost-btn"
              data-flush="end"
              aria-label="Refresh swarm board"
              title="Refresh (r)"
              disabled={loading}
              onClick={() => void reload()}
            >
              <RefreshIcon spinning={loading} />
            </button>
          </div>
        </div>

        <div
          className="agys-head-progress"
          data-status={snapshot?.kind === 'swarm' ? snapshot.summary.status : 'waiting'}
        >
          <div
            className="agys-head-progress-fill"
            style={{ transform: `scaleX(${progressRatio})`, opacity: progressRatio > 0 ? 1 : 0 }}
          />
          <div className="agys-head-sweep" />
        </div>
      </header>

      {error && <p role="alert" className="agys-alert">{error}</p>}

      <div className="agys-scroll-wrap">
        <div ref={scrollRef} className="agys-scroll">
          {snapshot === null && !error && (
            <div className="agys-empty">
              <p className="agys-empty-desc">
                <TextShimmer text="Loading swarm state…" active />
              </p>
            </div>
          )}
          {snapshot?.kind === 'unsupported' && (
            <div className="agys-empty">
              <span className="agys-empty-mark"><Icon name="Bot" className="size-4" /></span>
              <p className="agys-empty-title">Antigravity threads only</p>
              <p className="agys-empty-desc">
                Switch to an <code className="agys-inline-code">acp-antigravity</code> thread to view its live swarm board.
              </p>
            </div>
          )}
          {snapshot?.kind === 'no-session' && (
            <div className="agys-empty">
              <span className="agys-empty-mark"><Icon name="Bot" className="size-4" /></span>
              <p className="agys-empty-title">Ready to start a swarm</p>
              <p className="agys-empty-desc">
                Start your first prompt with <code className="agys-inline-code">/swarm &lt;task&gt;</code> and workers will appear here live.
              </p>
              <button type="button" className="agys-btn" onClick={() => insertSwarmPrefix(composer)}>
                Insert /swarm
              </button>
            </div>
          )}
          {snapshot?.kind === 'none' && (
            <div className="agys-empty">
              <span className="agys-empty-mark"><Icon name="Bot" className="size-4" /></span>
              <p className="agys-empty-title">No swarm in this conversation</p>
              <p className="agys-empty-desc">
                Send <code className="agys-inline-code">/swarm &lt;task&gt;</code> to spin up parallel workers on a shared board.
              </p>
              <button type="button" className="agys-btn" onClick={() => insertSwarmPrefix(composer)}>
                Insert /swarm
              </button>
            </div>
          )}
          {snapshot?.kind === 'swarm' && (
            <>
              {tab === 'overview' && (
                <OverviewView snapshot={snapshot} nowMs={nowMs} onInspectWorker={inspectWorker} />
              )}
              {tab === 'board' && (
                <BoardView
                  messages={snapshot.messages}
                  channels={snapshot.channels}
                  members={snapshot.members}
                  scrollRef={scrollRef}
                />
              )}
              {tab === 'workers' && (
                <WorkersView
                  threadId={threadId}
                  members={snapshot.members}
                  tasks={snapshot.plan?.tasks ?? {}}
                  selected={selectedWorker}
                  nowMs={nowMs}
                  onSelect={setSelectedWorker}
                  refreshKey={refreshKey}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SwarmBannerCard({ threadId }: { threadId: string }) {
  const panel = useAppPanel();
  const nowMs = useNowMs(15_000);
  const { snapshot } = useSwarmSnapshot(threadId, true);
  if (!snapshot || snapshot.kind !== 'swarm') return null;

  const { active } = snapshot.summary;
  const labelTitle = snapshot.title ?? snapshot.plan?.goalTitle ?? 'Antigravity Swarm';
  const statusText = formatBannerStatus(snapshot);
  const lastPost = snapshot.messages.at(-1) ?? null;
  const lastPostPreview = lastPost ? cleanBoardPreview(lastPost.text) : null;
  const recency = formatRelativeTime(lastPost?.time ?? snapshot.summary.lastActivityAt, nowMs);

  const openPanelTo = (intent?: PanelNavigationIntent) => {
    if (intent) dispatchPanelIntent(threadId, intent);
    panel.openTab({ tab: swarmTabRef, title: 'Swarm board' });
  };

  return (
    <CollapsibleStackCard
      label="Antigravity Swarm"
      title={`${labelTitle} · ${statusText}`}
      icon="Bot"
      isActive={active}
    >
      <div className="agys-stack-body">
        <div className="agys-stack-workers" role="group" aria-label="Swarm workers">
          {snapshot.members.filter(m => m.role !== 'coordinator').map(m => (
            <button
              key={m.name}
              type="button"
              className="agys-stack-worker"
              data-state={m.state}
              title={`Inspect @${m.name} (${formatMemberStateLabel(m.state)})`}
              onClick={() => openPanelTo({ tab: 'workers', member: m.name })}
            >
              <PhaseIndicator state={m.state} />
              <span>@{m.name}</span>
            </button>
          ))}
        </div>
        <div className="agys-stack-footer">
          <button
            type="button"
            className="agys-stack-last"
            title="Open board feed"
            onClick={() => openPanelTo({ tab: 'board' })}
          >
            {lastPost ? (
              <>
                <span className="agys-stack-last-meta">#{lastPost.seq} @{lastPost.agent}</span>
                <span className="agys-stack-last-text">{lastPostPreview || lastPost.text}</span>
                {recency && <span className="agys-stack-last-time">{recency}</span>}
              </>
            ) : (
              <span className="agys-stack-last-text">Board ready</span>
            )}
          </button>
          <button
            type="button"
            className="agys-btn-link"
            onClick={() => openPanelTo()}
          >
            Open board ›
          </button>
        </div>
      </div>
    </CollapsibleStackCard>
  );
}

function SwarmComposerBanner() {
  const { scope, selection } = useComposer();
  if (scope.kind !== 'thread' || !isAntigravityProviderId(selection?.providerId)) return null;
  return <SwarmBannerCard threadId={scope.threadId} />;
}

export default definePluginApp(app => {
  app.slots.experimental_tab({
    ...swarmTabRef,
    title: 'Swarm board',
    icon: 'Bot',
    layout: 'flush',
    component: SwarmPanel,
  });

  app.composer.customize({
    id: 'agy-swarm',
    scopes: ['thread', 'new-thread'],
    banners: [{ id: 'swarm-status', chrome: 'bare', component: SwarmComposerBanner }],
    plusMenu: [{
      id: 'start-swarm',
      label: 'Start Antigravity swarm',
      icon: 'Bot',
      description: 'Prefix the prompt with /swarm on Antigravity threads',
      disabled: composer => !isAntigravityProviderId(composer.selection?.providerId),
      run: ({ composer }) => { insertSwarmPrefix(composer); },
    }],
  });

  app.commands.register({
    id: 'toggle-board',
    title: 'Toggle Antigravity swarm board',
    defaultShortcut: { key: 's', mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ experimental_panel }) => {
      experimental_panel.toggleTab({ tab: swarmTabRef, title: 'Swarm board' });
    },
  });
});
