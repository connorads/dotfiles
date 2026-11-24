import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  definePluginApp,
  experimental_CollapsibleStackCard as CollapsibleStackCard,
  experimental_Icon as Icon,
  experimental_useAppPanel as useAppPanel,
  useComposer,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import type { PluginComposerApi, PluginRpcClient } from '@get-bb/plugin-sdk/app';
import type { BoardMessage, SwarmMember, SwarmSnapshot, WorkerLogResult, rpcContract } from './contracts.ts';
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
  const match = value.match(/\d{2}:\d{2}:\d{2}/u);
  return match ? match[0] : value;
}

function renderMentionText(text: string) {
  const parts = text.split(/(@[a-z0-9][a-z0-9_-]{0,31})/giu);
  return parts.map((part, idx) =>
    part.startsWith('@')
      ? <span key={idx} className="agys-mention">{part}</span>
      : <span key={idx}>{part}</span>,
  );
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
        if (fp !== printed.current) {
          await reload();
        }
      } catch {
        // Keep last good state; manual refresh surfaces errors.
      } finally {
        busy.current = false;
      }
    }, interval);
    return () => window.clearInterval(id);
  }, [enabled, isActive, reload, rpc, threadId]);

  return { snapshot, error, loading, reload };
}

function MemberRow({ member, task, onInspect }: { member: SwarmMember; task?: string; onInspect: (name: string) => void }) {
  return (
    <button type="button" className="agys-member-row" onClick={() => onInspect(member.name)}>
      <span className="agys-dot" data-state={member.state} aria-hidden="true" />
      <div className="agys-member-body">
        <div className="agys-member-top">
          <span className="agys-member-name">@{member.name}</span>
          <span className="agys-pill" data-tone={member.state}>{member.state}</span>
          {member.role !== 'worker' && <span className="agys-pill">{member.role}</span>}
          {member.model && <span className="agys-pill">{member.model}</span>}
          {member.workspaceMode !== 'inherit' && <span className="agys-pill">{member.workspaceMode}</span>}
          {member.unreadCount > 0 && <span className="agys-pill">{member.unreadCount} unread</span>}
        </div>
        {task && <div className="agys-member-task">{task}</div>}
        <div className="agys-member-activity">
          {member.activity ?? 'Idle'}{member.stepCount > 0 ? ` · ${member.stepCount} steps` : ''}
        </div>
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
  const pct = snapshot.summary.totalWorkers > 0
    ? Math.round((snapshot.summary.doneWorkers / snapshot.summary.totalWorkers) * 100)
    : 0;

  const assigned = new Set<string>();
  const threads = snapshot.plan?.threads ?? [];
  for (const t of threads) {
    for (const taskOwner of t.tasks) assigned.add(taskOwner);
  }
  const unassigned = snapshot.members.filter(m => !assigned.has(m.name));

  return (
    <div>
      {snapshot.summary.totalWorkers > 0 && (
        <div className="agys-progress-wrap">
          <div className="agys-subtitle">
            {snapshot.summary.doneWorkers} of {snapshot.summary.totalWorkers} workers done
            {snapshot.summary.workingWorkers > 0 ? ` · ${snapshot.summary.workingWorkers} working` : ''}
            {snapshot.summary.errorWorkers > 0 ? ` · ${snapshot.summary.errorWorkers} error` : ''}
          </div>
          <div className="agys-progress-track" aria-hidden="true">
            <div className="agys-progress-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {threads.length > 0 && (
        <>
          <h4 className="agys-section-title">Workstreams</h4>
          {threads.map(thread => (
            <section key={thread.id} className="agys-card">
              <div className="agys-card-head">
                <div className="agys-card-title">{thread.title}</div>
                {thread.goal && <div className="agys-card-goal">{thread.goal}</div>}
              </div>
              <div>
                {thread.tasks.map(name => {
                  const member = byName.get(name);
                  if (!member) return null;
                  return <MemberRow key={name} member={member} task={snapshot.plan?.tasks[name]} onInspect={onInspectWorker} />;
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {unassigned.length > 0 && (
        <>
          <h4 className="agys-section-title">{threads.length > 0 ? 'Other members' : 'Roster'}</h4>
          <section className="agys-card">
            {unassigned.map(member => (
              <MemberRow key={member.name} member={member} task={snapshot.plan?.tasks[member.name]} onInspect={onInspectWorker} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function BoardView({ messages, channels }: { messages: BoardMessage[]; channels: string[] }) {
  const [channel, setChannel] = useState<string>('all');
  const filtered = useMemo(
    () => (channel === 'all' ? messages : messages.filter(m => m.channel === channel)),
    [channel, messages],
  );

  return (
    <div>
      {channels.length > 1 && (
        <div className="agys-channels" role="group" aria-label="Swarm channels">
          <button type="button" className="agys-ch-btn" aria-pressed={channel === 'all'} onClick={() => setChannel('all')}>all</button>
          {channels.map(ch => (
            <button key={ch} type="button" className="agys-ch-btn" aria-pressed={channel === ch} onClick={() => setChannel(ch)}>
              #{ch}
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="agys-empty">No board messages yet.</p>
      ) : (
        <div className="agys-feed">
          {filtered.map(msg => (
            <article key={`${msg.seq}:${msg.agent}`} className="agys-post">
              <div className="agys-post-head">
                <span className="agys-seq">#{msg.seq}</span>
                <span className="agys-member-name">@{msg.agent}</span>
                {msg.channel !== 'main' && <span className="agys-pill">#{msg.channel}</span>}
                {msg.kind === 'brief' && <span className="agys-pill">brief</span>}
                {msg.isDone && <span className="agys-pill" data-tone="done">done</span>}
                {msg.isStall && <span className="agys-pill" data-tone="error">stall</span>}
                {msg.time && <span>{formatShortTime(msg.time)}</span>}
              </div>
              <div className="agys-post-body">{renderMentionText(msg.text)}</div>
            </article>
          ))}
        </div>
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

  if (!activeMember) return <p className="agys-empty">No members in this swarm yet.</p>;

  return (
    <div>
      <div className="agys-worker-picker" role="group" aria-label="Select swarm member">
        {members.map(m => (
          <button
            key={m.name}
            type="button"
            className="agys-worker-btn"
            aria-pressed={m.name === activeMember}
            onClick={() => onSelect(m.name)}
          >
            <span className="agys-dot" data-state={m.state} style={{ marginTop: 0 }} aria-hidden="true" />
            @{m.name}
          </button>
        ))}
      </div>

      {loading && !log && <p className="agys-empty">Loading transcript…</p>}
      {log && !log.ok && <p className="agys-note agys-error">{log.reason}</p>}
      {log && log.ok && log.steps.length === 0 && <p className="agys-empty">No steps recorded for @{log.member} yet.</p>}
      {log && log.ok && log.steps.length > 0 && (
        <div>
          <p className="agys-subtitle" style={{ marginBottom: 8 }}>
            Showing latest {log.steps.length} of {log.totalSteps} steps for @{log.member}
          </p>
          {[...log.steps].reverse().map(step => (
            <div key={step.stepIndex} className="agys-step">
              <div className="agys-step-head">
                <span className="agys-seq">#{step.stepIndex}</span>
                <span>{step.type}</span>
                <span className="agys-pill">{step.status}</span>
                {step.model && <span className="agys-pill">{step.model}</span>}
                {step.time && <span>{formatShortTime(step.time)}</span>}
              </div>
              {step.toolCalls.length > 0 && (
                <div className="agys-tool-list">
                  {step.toolCalls.map((call, idx) => (
                    <div key={idx} className="agys-tool-item">
                      <strong>{call.name}</strong>{call.argsPreview ? `(${call.argsPreview})` : '()'}
                    </div>
                  ))}
                </div>
              )}
              {step.text && <div className="agys-step-text">{step.text}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SwarmPanel({ threadId }: { threadId: string }) {
  const composer = useComposer();
  const [tab, setTab] = useState<ViewTab>('overview');
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const { snapshot, error, loading, reload } = useSwarmSnapshot(threadId, true);

  const inspectWorker = useCallback((name: string) => {
    setSelectedWorker(name);
    setTab('workers');
  }, []);

  const refreshKey = snapshot?.kind === 'swarm'
    ? `${snapshot.boardHead}:${snapshot.members.map(m => `${m.name}:${m.stepCount}:${m.state}`).join(',')}`
    : '';

  return (
    <div className="agys-panel">
      <div className="agys-toolbar">
        <div className="agys-tabs" role="tablist" aria-label="Swarm board sections">
          {(['overview', 'board', 'workers'] as const).map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {id === 'overview' ? 'Overview' : id === 'board' ? `Board${snapshot?.kind === 'swarm' ? ` (${snapshot.boardHead})` : ''}` : 'Workers'}
            </button>
          ))}
        </div>
        <div className="agys-meta-bar">
          {snapshot?.kind === 'swarm' && (
            <span className="agys-pill" data-tone={snapshot.summary.active ? 'working' : 'done'}>
              {snapshot.summary.active ? 'Live' : 'Idle'}
            </span>
          )}
          <button
            type="button"
            className="agys-icon-btn"
            aria-label="Refresh swarm board"
            title="Refresh swarm board"
            disabled={loading}
            onClick={() => void reload()}
          >
            <Icon name="RefreshCw" className="size-3.5" />
          </button>
        </div>
      </div>

      {snapshot?.kind === 'swarm' && (
        <div className="agys-header-ctx">
          <div className="agys-title-row">
            <span className="agys-title">{snapshot.title ?? snapshot.plan?.goalTitle ?? 'Antigravity Swarm'}</span>
          </div>
          {snapshot.plan?.goalLine && <span className="agys-subtitle">{snapshot.plan.goalLine}</span>}
        </div>
      )}

      {error && <p role="alert" className="agys-note agys-error">{error}</p>}

      <div className="agys-scroll">
        {snapshot === null && !error && <p className="agys-empty">Loading swarm state…</p>}
        {snapshot?.kind === 'unsupported' && (
          <div className="agys-empty">
            <p>Swarm Board supports Antigravity (<code>acp-antigravity</code>) threads.</p>
          </div>
        )}
        {snapshot?.kind === 'no-session' && (
          <div className="agys-empty">
            <p>Send a message on this Antigravity thread to establish a session.</p>
            <button type="button" className="agys-btn" onClick={() => insertSwarmPrefix(composer)}>
              Insert /swarm
            </button>
          </div>
        )}
        {snapshot?.kind === 'none' && (
          <div className="agys-empty">
            <p>No swarm in this conversation yet. Start one with <code>/swarm &lt;task&gt;</code>.</p>
            <button type="button" className="agys-btn" onClick={() => insertSwarmPrefix(composer)}>
              Insert /swarm
            </button>
          </div>
        )}
        {snapshot?.kind === 'swarm' && (
          <>
            {tab === 'overview' && <OverviewView snapshot={snapshot} onInspectWorker={inspectWorker} />}
            {tab === 'board' && <BoardView messages={snapshot.messages} channels={snapshot.channels} />}
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
              <span className="agys-dot" data-state={m.state} style={{ marginTop: 0 }} aria-hidden="true" />
              @{m.name}
            </span>
          ))}
        </div>
        {lastPost && (
          <div className="agys-stack-last">
            #{lastPost.seq} @{lastPost.agent}: {lastPost.text}
          </div>
        )}
        <div className="agys-stack-actions">
          <button
            type="button"
            className="agys-btn"
            onClick={() => { panel.openTab({ tab: swarmTabRef, title: 'Swarm board' }); }}
          >
            Open Swarm board
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
