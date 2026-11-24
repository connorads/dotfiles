import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  definePluginApp,
  experimental_CollapsibleStackCard as CollapsibleStackCard,
  experimental_Icon as Icon,
  experimental_useAppPanel as useAppPanel,
  useComposer,
  useRealtime,
  useRpc,
} from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { segments, summarise, type BoardView, type EntryView } from './src/format.ts';
import './app.css';

// Kept equal to the constants in contracts.ts, which the app bundle cannot import at runtime.
const changedChannel = 'swarm-changed';
const boardDirective = 'swarm-board';
const boardTab = { id: 'board', context: { kind: 'thread' as const }, availability: 'action' as const };
const swarmIdPattern = /^[0-9a-f-]{36}$/;

type Source = { threadId: string } | { swarmId: string };
type Run = BoardView['members'][number]['run'];

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

function Roster({ board }: { board: BoardView }) {
  return (
    <ul className="swarm-roster" aria-label="Members">
      {board.members.map(member => {
        // A closed swarm keeps each member's last state, which no longer describes its thread.
        const run: Run = board.closed ? 'stopped' : member.run;
        return (
          <li key={member.name} data-run={run} title={board.closed ? member.name : `${member.name} is ${member.run}`}>
            <StatusMark run={run} />
            {member.name}
          </li>
        );
      })}
    </ul>
  );
}

function Marked({ text }: { text: string }) {
  return <>{segments(text).map((part, index) => (part.mark ? <mark key={index}>{part.text}</mark> : part.text))}</>;
}

/** One entry on one line, for the cards. */
function EntryLine({ entry }: { entry: EntryView }) {
  return (
    <li className="swarm-line" data-tone={entry.tone}>
      <span className="swarm-seq">#{entry.seq}</span>
      <span className="swarm-author">{entry.author}</span>
      <span className="swarm-line-text"><Marked text={entry.text} /></span>
    </li>
  );
}

function Entry({ entry }: { entry: EntryView }) {
  return (
    <li className="swarm-entry" data-tone={entry.tone}>
      <div className="swarm-entry-head">
        <span className="swarm-seq">#{entry.seq}</span>
        <span className="swarm-author">{entry.author}</span>
        {entry.tone === 'relay' && <span className="swarm-tag">relayed reply</span>}
        <time dateTime={new Date(entry.at).toISOString()}>
          {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </time>
      </div>
      <p className="swarm-text"><Marked text={entry.text} /></p>
      {entry.detail && <p className="swarm-detail"><Marked text={entry.detail} /></p>}
    </li>
  );
}

function useOpenBoard(swarmId: string | null) {
  const panel = useAppPanel();
  return () => panel.openTab({ tab: boardTab, title: 'Swarm', ...(swarmId ? { params: { swarmId } } : {}) });
}

/* --------------------------------- panel --------------------------------- */

function BoardPanel({ threadId, params }: { threadId: string; params?: unknown }) {
  const requested = (params as { swarmId?: unknown } | null | undefined)?.swarmId;
  const source: Source = typeof requested === 'string' && swarmIdPattern.test(requested) ? { swarmId: requested } : { threadId };
  const { board, error, rpc } = useBoard(source);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const feed = useRef<HTMLOListElement>(null);
  const count = board?.entries.length ?? 0;

  useLayoutEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight });
  }, [count]);

  if (error) return <p className="swarm-empty" role="alert">The board could not be loaded: {error}</p>;
  if (board === undefined) return <p className="swarm-empty">Loading the board.</p>;
  if (board === null) {
    return <p className="swarm-empty">This thread has no swarm. Ask its agent to start one, and the board appears here.</p>;
  }

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

  return (
    <section className="swarm-panel" aria-label="Swarm board">
      <header className="swarm-panel-head">
        <Roster board={board} />
        <span className="swarm-summary">{summarise(board)}</span>
      </header>
      <ol className="swarm-feed" ref={feed}>
        {board.entries.map(entry => <Entry key={entry.seq} entry={entry} />)}
      </ol>
      {notice && <p className="swarm-notice" role="alert">{notice}</p>}
      {board.closed ? (
        <p className="swarm-closed">This swarm is closed.</p>
      ) : (
        <form className="swarm-compose" onSubmit={post}>
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            aria-label="Post to the board as human"
            placeholder="Post as human. @name wakes a member; no mention goes to the coordinator."
          />
          <div className="swarm-actions">
            <button type="button" className="swarm-button" data-variant="quiet" onClick={() => void report(rpc.call('close', { swarmId: board.id }))}>
              Close swarm
            </button>
            <button type="submit" className="swarm-button" disabled={!draft.trim()}>Post</button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ------------------------------ composer card ----------------------------- */

function ComposerCard({ threadId }: { threadId: string }) {
  const { board } = useBoard({ threadId });
  const openBoard = useOpenBoard(null);
  if (!board || board.closed) return null;
  const last = board.entries.at(-1);

  return (
    <CollapsibleStackCard
      label="Swarm"
      title={`Swarm · ${summarise(board)}`}
      icon="Bot"
      isActive={board.members.some(member => member.run === 'working')}
    >
      <div className="swarm-stack">
        <Roster board={board} />
        <div className="swarm-stack-foot">
          <ul className="swarm-lines">{last && <EntryLine entry={last} />}</ul>
          <button type="button" className="swarm-link" onClick={openBoard}>
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
  const recent = board.entries.slice(-3);

  return (
    <section className="swarm-card" aria-label="Swarm board">
      <header className="swarm-card-head">
        <Icon name="Bot" aria-hidden />
        <span className="swarm-card-title">Swarm</span>
        <span className="swarm-summary">{summarise(board)}</span>
      </header>
      <div className="swarm-card-body">
        <Roster board={board} />
        <ul className="swarm-lines">
          {recent.map(entry => <EntryLine key={entry.seq} entry={entry} />)}
        </ul>
      </div>
      <footer className="swarm-card-foot">
        <span className="swarm-card-count">{board.entries.length === 1 ? '1 entry' : `${board.entries.length} entries`}</span>
        <button type="button" className="swarm-link" onClick={openBoard}>
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
