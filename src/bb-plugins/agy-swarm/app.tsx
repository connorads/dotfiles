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
import type { BoardMessage, SwarmMember, SwarmSnapshot, WorkerLogResult, WorkerStep, rpcContract } from './contracts.ts';
import { AnimatedNumber, CountSuffix, PhaseIndicator, SegmentedControl, TextShimmer } from './ui/primitives.tsx';
import './app.css';

type Rpc = PluginRpcClient<typeof rpcContract>;
type ViewTab = 'overview' | 'board' | 'workers';

const swarmTabRef = { id: 'swarm', context: { kind: 'thread' as const }, availability: 'action' as const };
const activePollMs = 2_000;
const idlePollMs = 6_000;

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

function formatTokens(input: number | null, output: number | null): string | null {
  if (input === null && output === null) return null;
  const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  if (input !== null && output !== null) return `${k(input)} in · ${k(output)} out`;
  return input !== null ? `${k(input)} in` : `${k(output!)} out`;
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

function MemberRow({ member, task, onInspect }: { member: SwarmMember; task?: string; onInspect: (name: string) => void }) {
  const model = formatModel(member.model);
  const activity = member.activity ?? (member.state === 'waiting' ? 'Waiting for @mentions' : 'Idle');
  return (
    <button type="button" className="agys-row" onClick={() => onInspect(member.name)}>
      <span className="agys-row-mark">
        <PhaseIndicator state={member.state} />
      </span>
      <div className="agys-row-main">
        <div className="agys-row-line">
          <span className="agys-name">@{member.name}</span>
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
  onInspectWorker,
}: {
  snapshot: Extract<SwarmSnapshot, { kind: 'swarm' }>;
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
            return <MemberRow key={name} member={member} task={snapshot.plan?.tasks[name]} onInspect={onInspectWorker} />;
          })}
        </section>
      ))}

      {unassigned.length > 0 && (
        <section className="agys-group">
          <div className="agys-group-head">
            <h4 className="agys-group-title">{threads.length > 0 ? 'Coordination' : 'Roster'}</h4>
          </div>
          {unassigned.map(member => (
            <MemberRow key={member.name} member={member} task={snapshot.plan?.tasks[member.name]} onInspect={onInspectWorker} />
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
                {msg.isStall && <span className="agys-tag" data-tone="error">stall</span>}
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

function StepRow({ step }: { step: WorkerStep }) {
  const tokens = formatTokens(step.inputTokens, step.outputTokens);
  const label = formatStepLabel(step.type, step.source);
  const failed = step.status.toUpperCase() === 'ERROR' || step.status.toUpperCase() === 'FAILED';

  return (
    <div className="agys-step">
      <div className="agys-step-head">
        <span className="agys-seq">#{step.stepIndex}</span>
        <span className="agys-step-type">{label}</span>
        {failed && <span className="agys-tag" data-tone="error">{step.status.toLowerCase()}</span>}
        {step.time && <span>{formatShortTime(step.time)}</span>}
        {tokens && <span className="agys-step-tokens">{tokens}</span>}
      </div>

      {step.toolCalls.length > 0 && (
        <div className="agys-tool-list">
          {step.toolCalls.map((call, idx) => (
            <div key={idx} className="agys-tool-row">
              <span className="agys-tool-name">{call.name}</span>
              {call.argsPreview && <span className="agys-tool-args">{call.argsPreview}</span>}
            </div>
          ))}
        </div>
      )}

      {step.thinking && (
        <details className="agys-step-details">
          <summary>Thinking</summary>
          <div className="agys-step-text">{step.thinking}</div>
        </details>
      )}

      {step.text && (
        step.type === 'GENERIC' && step.text.length > 160 ? (
          <details className="agys-step-details">
            <summary>Output ({step.text.length} chars)</summary>
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
  selected,
  onSelect,
  refreshKey,
}: {
  threadId: string;
  members: SwarmMember[];
  selected: string | null;
  onSelect: (name: string) => void;
  refreshKey: string;
}) {
  const rpc: Rpc = useRpc<typeof rpcContract>();
  const activeMember = selected && members.some(m => m.name === selected)
    ? selected
    : members.find(m => m.role === 'worker')?.name ?? members[0]?.name ?? null;
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

  if (!activeMember) {
    return (
      <div className="agys-empty">
        <p className="agys-empty-desc">No members in this swarm yet.</p>
      </div>
    );
  }

  const visibleSteps = useMemo(() => {
    if (!log || !log.ok) return [];
    const base = showSystem ? log.steps : log.steps.filter(s => s.type !== 'SYSTEM_MESSAGE');
    return [...base].reverse();
  }, [log, showSystem]);

  return (
    <div>
      <div className="agys-worker-bar" role="group" aria-label="Select swarm member">
        {members.map(m => (
          <button
            key={m.name}
            type="button"
            className="agys-worker-pill"
            aria-pressed={m.name === activeMember}
            onClick={() => onSelect(m.name)}
          >
            <PhaseIndicator state={m.state} />
            <span>@{m.name}</span>
          </button>
        ))}
      </div>

      {log && log.ok && (
        <div className="agys-worker-subbar">
          <span>
            <AnimatedNumber value={visibleSteps.length} /> of <AnimatedNumber value={log.totalSteps} />{' '}
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
      {log && log.ok && visibleSteps.length === 0 && (
        <div className="agys-empty">
          <p className="agys-empty-desc">No activity steps recorded for @{log.member} yet.</p>
        </div>
      )}
      {visibleSteps.map(step => <StepRow key={step.stepIndex} step={step} />)}
    </div>
  );
}

function SwarmPanel({ threadId }: { threadId: string }) {
  const composer = useComposer();
  const [tab, setTab] = useState<ViewTab>('overview');
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { snapshot, error, loading, reload } = useSwarmSnapshot(threadId, true);

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
              {snapshot.summary.totalWorkers > 0 && (
                <span className="agys-stat-summary">
                  <strong><AnimatedNumber value={snapshot.summary.doneWorkers} /></strong>
                  <span>/</span>
                  <AnimatedNumber value={snapshot.summary.totalWorkers} />
                  <span>done</span>
                </span>
              )}
              <PhaseIndicator state={snapshot.summary.active ? 'working' : snapshot.summary.errorWorkers > 0 ? 'error' : 'done'} />
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
          <button
            type="button"
            className="agys-ghost-btn"
            data-flush="end"
            aria-label="Refresh swarm board"
            title="Refresh (r)"
            disabled={loading}
            onClick={() => void reload()}
          >
            <Icon name="RefreshCw" className="size-3.5" />
          </button>
        </div>

        <div className="agys-head-progress" data-active={snapshot?.kind === 'swarm' && snapshot.summary.active ? 'true' : 'false'}>
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
              <span className="agys-empty-mark"><Icon name="Users" className="size-4" /></span>
              <p className="agys-empty-title">Antigravity threads only</p>
              <p className="agys-empty-desc">
                Switch to an <code className="agys-inline-code">acp-antigravity</code> thread to view its live swarm board.
              </p>
            </div>
          )}
          {snapshot?.kind === 'no-session' && (
            <div className="agys-empty">
              <span className="agys-empty-mark"><Icon name="Users" className="size-4" /></span>
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
              <span className="agys-empty-mark"><Icon name="Users" className="size-4" /></span>
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
              {tab === 'overview' && <OverviewView snapshot={snapshot} onInspectWorker={inspectWorker} />}
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
                  selected={selectedWorker}
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
  const { snapshot } = useSwarmSnapshot(threadId, true);
  if (!snapshot || snapshot.kind !== 'swarm') return null;

  const { totalWorkers, workingWorkers, doneWorkers, active } = snapshot.summary;
  const labelTitle = snapshot.title ?? snapshot.plan?.goalTitle ?? 'Antigravity Swarm';
  const countText = totalWorkers > 0
    ? `${doneWorkers}/${totalWorkers} done${workingWorkers > 0 ? ` · ${workingWorkers} working` : ''}`
    : `${snapshot.boardHead} posts`;
  const lastPost = snapshot.messages.at(-1) ?? null;

  return (
    <CollapsibleStackCard
      label="Antigravity Swarm"
      title={`Swarm · ${labelTitle} · ${countText}`}
      icon="Users"
      isActive={active}
    >
      <div className="agys-stack-body">
        <div className="agys-stack-workers">
          {snapshot.members.filter(m => m.role !== 'coordinator').map(m => (
            <span key={m.name} className="agys-stack-worker">
              <PhaseIndicator state={m.state} />
              <span>@{m.name}</span>
            </span>
          ))}
        </div>
        <div className="agys-stack-footer">
          <div className="agys-stack-last">
            {lastPost ? `#${lastPost.seq} @${lastPost.agent}: ${lastPost.text}` : 'Board ready'}
          </div>
          <button
            type="button"
            className="agys-btn-link"
            onClick={() => { panel.openTab({ tab: swarmTabRef, title: 'Swarm board' }); }}
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
    icon: 'Users',
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
      icon: 'Users',
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
