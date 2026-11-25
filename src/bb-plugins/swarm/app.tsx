import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  definePluginApp,
  experimental_CollapsibleStackCard as CollapsibleStackCard,
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useAppPanel as useAppPanel,
  Markdown,
  ThreadChat,
  useBbNavigate,
  useComposer,
  useRealtime,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { age, emphasiseMentions, preview, summarise, type BoardView, type EntryView, type MemberView } from './src/format.ts';
import './app.css';

// Kept equal to the constants in contracts.ts, which the app bundle cannot import at runtime.
const changedChannel = 'swarm-changed';
const boardDirective = 'swarm-board';
const boardTab = { id: 'board', context: { kind: 'thread' as const }, availability: 'action' as const };
const swarmIdPattern = /^[0-9a-f-]{36}$/;

type Source = { threadId: string } | { swarmId: string };
type Run = MemberView['run'];

/* ---------------------------------- data ---------------------------------- */

/** `undefined` while loading, `null` when there is no swarm. */
function useBoard(source: Source) {
  const rpc = useRpc<typeof rpcContract>();
  const [board, setBoard] = useState<BoardView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const key = 'swarmId' in source ? `swarm:${source.swarmId}` : `thread:${source.threadId}`;

  const load = useCallback(() => {
    const call = ++latest.current;
    const [kind, id] = key.split(/:(.*)/) as [string, string];
    const request = kind === 'swarm' ? rpc.call('swarm', { swarmId: id }) : rpc.call('board', { threadId: id });
    request.then(
      result => {
        if (call !== latest.current) return;
        setBoard(result.board);
        setError(null);
      },
      cause => {
        if (call === latest.current) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [rpc, key]);

  useEffect(() => {
    setBoard(undefined);
    load();
  }, [load]);
  useRealtime(changedChannel, load);

  return { board, error, rpc };
}

/** A clock that ticks slowly enough for relative times. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The newest thing each member said. */
function lastWords(board: BoardView): Map<string, EntryView> {
  const last = new Map<string, EntryView>();
  for (const entry of board.entries) if (entry.tone === 'post' || entry.tone === 'relay') last.set(entry.author, entry);
  return last;
}

/** A closed swarm keeps each member's last state, which no longer describes its thread. */
const shownRun = (board: BoardView, member: MemberView): Run => (board.closed ? 'stopped' : member.run);

/* ------------------------------- small parts ------------------------------ */

/**
 * Pins the pulse to the document timeline so every working mark beats together,
 * whenever it mounted.
 */
function usePhaseLock(active: boolean) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      for (const animation of ref.current?.getAnimations({ subtree: true }) ?? []) animation.startTime = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);
  return ref;
}

function StatusMark({ run }: { run: Run }) {
  const ref = usePhaseLock(run === 'working');
  return (
    <span ref={ref} className="swarm-mark" data-run={run} aria-hidden="true">
      {run === 'working' && <span className="swarm-mark-ring" />}
      <span className="swarm-mark-core" />
    </span>
  );
}

/** Provider icon, model, reasoning and account, as far as BB knows them. */
function Runtime({ member }: { member: MemberView }) {
  if (!member.provider) return null;
  const { provider } = member;
  const parts = [member.model ?? provider.name, member.reasoning, member.account].filter(Boolean);
  return (
    <span className="swarm-runtime" title={`${provider.name}${member.model ? ` · ${member.model}` : ''}`}>
      <ProviderIcon
        providerKind="agent"
        provider={{ id: provider.id, logoUrl: provider.logoUrl, icon: provider.glyph ? { glyph: provider.glyph } : null }}
        fallback="Bot"
        className="swarm-runtime-icon"
        aria-hidden
      />
      {parts.map((part, index) => (
        <span key={index} className="swarm-runtime-part">{part}</span>
      ))}
    </span>
  );
}

function Time({ at, now }: { at: number; now: number }) {
  const date = new Date(at);
  return (
    <time dateTime={date.toISOString()} title={date.toLocaleString()}>
      {age(at, now)}
    </time>
  );
}

/** One member on one row: who it is, what it runs on, and the last thing it said. */
function MemberRow({ board, member, last, onOpen }: { board: BoardView; member: MemberView; last: EntryView | undefined; onOpen: () => void }) {
  const run = shownRun(board, member);
  return (
    <li>
      <button type="button" className="swarm-member" data-run={run} onClick={onOpen} title={`Open ${member.name} in the panel`}>
        <StatusMark run={run} />
        <span className="swarm-member-name">{member.name}</span>
        <Runtime member={member} />
        <span className="swarm-member-last">{last ? preview(last.text) : board.closed ? '' : run}</span>
      </button>
    </li>
  );
}

function useOpenBoard(swarmId: string | null) {
  const panel = useAppPanel();
  return (member?: string) =>
    panel.openTab({ tab: boardTab, title: 'Swarm', params: { ...(swarmId ? { swarmId } : {}), ...(member ? { member } : {}) } });
}

/* ---------------------------------- feed ---------------------------------- */

function FeedEntry({ entry, now }: { entry: EntryView; now: number }) {
  if (entry.tone === 'engine' || entry.tone === 'problem') {
    return (
      <li className="swarm-event" data-tone={entry.tone}>
        <span className="swarm-event-line">
          <span className="swarm-event-text">{entry.text}</span>
          <Time at={entry.at} now={now} />
        </span>
        {entry.detail && (
          <details className="swarm-brief">
            <summary>Brief</summary>
            <Markdown content={entry.detail} className="swarm-markdown" />
          </details>
        )}
      </li>
    );
  }
  return (
    <li className="swarm-post" data-author={entry.author === 'human' ? 'human' : 'member'}>
      <header className="swarm-post-head">
        <span className="swarm-author">{entry.author === 'human' ? 'You' : entry.author}</span>
        {entry.tone === 'relay' && <span className="swarm-tag" title="The turn ended without a post, so the engine relayed the final reply">relayed</span>}
        <span className="swarm-seq">#{entry.seq}</span>
        <Time at={entry.at} now={now} />
      </header>
      <Markdown content={emphasiseMentions(entry.text)} className="swarm-markdown" />
    </li>
  );
}

function Feed({ entries, now }: { entries: EntryView[]; now: number }) {
  const feed = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  useLayoutEffect(() => {
    if (pinned.current) feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [entries.length]);
  return (
    <ol
      className="swarm-feed"
      ref={feed}
      onScroll={event => {
        const box = event.currentTarget;
        // Follow new entries only while the reader is already at the bottom.
        pinned.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
      }}
    >
      {entries.map(entry => <FeedEntry key={entry.seq} entry={entry} now={now} />)}
    </ol>
  );
}

/* --------------------------------- panel --------------------------------- */

function Compose({ board, rpc }: { board: BoardView; rpc: ReturnType<typeof useBoard>['rpc'] }) {
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const report = (action: Promise<{ ok: boolean; text: string }>) =>
    action.then(
      outcome => setNotice(outcome.ok ? null : outcome.text),
      cause => setNotice(cause instanceof Error ? cause.message : String(cause)),
    );
  const post = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void report(rpc.call('post', { swarmId: board.id, text }));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) post();
  };
  const mention = (name: string) => {
    setDraft(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}@${name} `);
    input.current?.focus();
  };
  const targets = ['all', ...board.members.filter(member => member.run !== 'stopped').map(member => member.name)];

  return (
    <form className="swarm-compose" onSubmit={post}>
      {notice && <p className="swarm-notice" role="alert">{notice}</p>}
      <div className="swarm-mentions" role="group" aria-label="Mention a member">
        {targets.map(name => (
          <button key={name} type="button" className="swarm-chip" onClick={() => mention(name)}>@{name}</button>
        ))}
      </div>
      <textarea
        ref={input}
        value={draft}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        aria-label="Post to the board as human"
        placeholder="Post to the board. A mention wakes that member; no mention goes to the coordinator."
      />
      <div className="swarm-actions">
        <button
          type="button"
          className="swarm-button"
          data-variant={confirming ? 'danger' : 'quiet'}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            setConfirming(false);
            void report(rpc.call('close', { swarmId: board.id }));
          }}
        >
          {confirming ? 'Stop every worker?' : 'Close swarm'}
        </button>
        <span className="swarm-hint">⌘↵</span>
        <button type="submit" className="swarm-button" disabled={!draft.trim()}>Post</button>
      </div>
    </form>
  );
}

function MemberPane({ board, member, here, now }: { board: BoardView; member: MemberView; here: string; now: number }) {
  const navigate = useBbNavigate();
  const run = shownRun(board, member);
  const joined = board.entries.find(entry => entry.detail !== null && entry.text.startsWith(`${member.name} joined`));
  const own = board.entries.filter(entry => entry.author === member.name);
  const isHere = member.threadId === here;

  return (
    <div className="swarm-detail">
      <header className="swarm-detail-head">
        <div className="swarm-detail-title">
          <StatusMark run={run} />
          <span className="swarm-member-name">{member.name}</span>
          <span className="swarm-summary">{member.role} · {run}</span>
          {!isHere && (
            <button type="button" className="swarm-link" onClick={() => navigate.toThread(member.threadId)}>
              Open thread
              <Icon name="ArrowUpRight" aria-hidden />
            </button>
          )}
        </div>
        <Runtime member={member} />
        {joined?.detail && (
          <details className="swarm-brief">
            <summary>Brief</summary>
            <Markdown content={joined.detail} className="swarm-markdown" />
          </details>
        )}
      </header>
      {isHere ? (
        // This panel sits beside the member's own chat, so show what it said on the board instead.
        own.length ? <Feed entries={own} now={now} /> : <p className="swarm-empty">{member.name} has not posted yet.</p>
      ) : (
        <div className="swarm-chat">
          <ThreadChat threadId={member.threadId} variant="compact" />
        </div>
      )}
    </div>
  );
}

function BoardPanel({ threadId, params }: { threadId: string; params?: unknown }) {
  const requested = (params ?? {}) as { swarmId?: unknown; member?: unknown };
  const source: Source = typeof requested.swarmId === 'string' && swarmIdPattern.test(requested.swarmId) ? { swarmId: requested.swarmId } : { threadId };
  const { board, error, rpc } = useBoard(source);
  const now = useNow();
  const [view, setView] = useState<string>('board');
  const asked = typeof requested.member === 'string' ? requested.member : null;
  useEffect(() => {
    setView(asked ?? 'board');
  }, [asked]);

  if (error) return <p className="swarm-empty" role="alert">The board could not be loaded: {error}</p>;
  if (board === undefined) return <p className="swarm-empty">Loading the board.</p>;
  if (board === null) {
    return <p className="swarm-empty">This thread has no swarm. Ask its agent to start one, and the board appears here.</p>;
  }
  const member = board.members.find(candidate => candidate.name === view) ?? null;

  return (
    <section className="swarm-panel" aria-label="Swarm board">
      <header className="swarm-panel-head">
        <div className="swarm-tabs" role="tablist" aria-label="Board and members">
          <button type="button" role="tab" aria-selected={!member} className="swarm-tab" onClick={() => setView('board')}>
            Board
            <span className="swarm-count">{board.entries.length}</span>
          </button>
          {board.members.map(candidate => (
            <button
              key={candidate.name}
              type="button"
              role="tab"
              aria-selected={member?.name === candidate.name}
              className="swarm-tab"
              onClick={() => setView(candidate.name)}
            >
              <StatusMark run={shownRun(board, candidate)} />
              {candidate.name}
            </button>
          ))}
        </div>
        <div className="swarm-panel-meta">
          <span className="swarm-summary">{summarise(board)}</span>
          <span className="swarm-summary" title="Each wake starts one agent turn. The swarm pauses at the limit.">
            {board.wakes} of {board.maxWakes} wakes
          </span>
        </div>
      </header>
      {member ? (
        <MemberPane board={board} member={member} here={threadId} now={now} />
      ) : (
        <>
          <Feed entries={board.entries} now={now} />
          {board.closed ? <p className="swarm-closed">This swarm is closed.</p> : <Compose board={board} rpc={rpc} />}
        </>
      )}
    </section>
  );
}

/* ------------------------------ composer card ----------------------------- */

function ComposerCard({ threadId }: { threadId: string }) {
  const { board } = useBoard({ threadId });
  const openBoard = useOpenBoard(null);
  if (!board || board.closed) return null;
  const last = lastWords(board);

  return (
    <CollapsibleStackCard
      label="Swarm"
      title={`Swarm · ${summarise(board)}`}
      icon="Bot"
      isActive={board.members.some(member => member.run === 'working')}
    >
      <div className="swarm-stack">
        <ul className="swarm-members">
          {board.members.map(member => (
            <MemberRow key={member.name} board={board} member={member} last={last.get(member.name)} onOpen={() => openBoard(member.name)} />
          ))}
        </ul>
        <div className="swarm-foot">
          <span className="swarm-summary">{board.wakes} of {board.maxWakes} wakes</span>
          <button type="button" className="swarm-link" onClick={() => openBoard()}>
            Open board
            <Icon name="ArrowRight" aria-hidden />
          </button>
        </div>
      </div>
    </CollapsibleStackCard>
  );
}

function ComposerBanner() {
  const { scope } = useComposer();
  return scope.kind === 'thread' ? <ComposerCard threadId={scope.threadId} /> : null;
}

/* -------------------------------- chat card ------------------------------- */

function ChatCard({ attributes, source }: { attributes: Readonly<Record<string, string>>; source: string }) {
  const id = attributes.id ?? '';
  if (!swarmIdPattern.test(id)) return <code>{source}</code>;
  return <LoadedChatCard swarmId={id} />;
}

function LoadedChatCard({ swarmId }: { swarmId: string }) {
  const { board, error } = useBoard({ swarmId });
  const openBoard = useOpenBoard(swarmId);
  if (error) return <p className="swarm-card swarm-card-note" role="alert">The swarm board could not be loaded.</p>;
  if (board === undefined) return <p className="swarm-card swarm-card-note">Loading the swarm board.</p>;
  if (board === null) return <p className="swarm-card swarm-card-note">This swarm no longer exists.</p>;
  const last = lastWords(board);

  return (
    <section className="swarm-card" aria-label="Swarm board">
      <header className="swarm-card-head">
        <Icon name="Bot" aria-hidden />
        <span className="swarm-card-title">Swarm</span>
        <span className="swarm-summary">{summarise(board)}</span>
        <span className="swarm-summary swarm-card-wakes">{board.wakes} of {board.maxWakes} wakes</span>
      </header>
      <ul className="swarm-members">
        {board.members.map(member => (
          <MemberRow key={member.name} board={board} member={member} last={last.get(member.name)} onOpen={() => openBoard(member.name)} />
        ))}
      </ul>
      <footer className="swarm-foot swarm-card-foot">
        <span className="swarm-summary">{board.entries.length === 1 ? '1 entry' : `${board.entries.length} entries`}</span>
        <button type="button" className="swarm-link" onClick={() => openBoard()}>
          Open in right panel
          <Icon name="ArrowRight" aria-hidden />
        </button>
      </footer>
    </section>
  );
}

export default definePluginApp(app => {
  app.slots.experimental_tab({ ...boardTab, title: 'Swarm', icon: 'Bot', layout: 'flush', component: BoardPanel });
  app.slots.messageDirective({ id: boardDirective, component: ChatCard });
  app.composer.customize({
    id: 'swarm',
    scopes: ['thread'],
    banners: [{ id: 'board', chrome: 'bare', component: ComposerBanner }],
  });

  app.commands.register({
    id: 'toggle-board',
    title: 'Toggle swarm board',
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ experimental_panel }) => {
      experimental_panel.toggleTab({ tab: boardTab, title: 'Swarm' });
    },
  });
});
