import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { definePluginApp, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { segments, type BoardView, type EntryView } from './src/format.ts';
import './app.css';

// Kept equal to `changedChannel` in contracts.ts, which the app bundle cannot import at runtime.
const changedChannel = 'swarm-changed';
const boardTab = { id: 'board', context: { kind: 'thread' as const }, availability: 'action' as const };

function useBoard(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [board, setBoard] = useState<BoardView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(() => {
    const call = ++latest.current;
    rpc.call('board', { threadId }).then(
      result => {
        if (call !== latest.current) return;
        setBoard(result.board);
        setError(null);
      },
      cause => {
        if (call === latest.current) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }, [rpc, threadId]);

  useEffect(() => {
    setBoard(undefined);
    load();
  }, [load]);
  useRealtime(changedChannel, load);

  return { board, error, rpc };
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
      <p className="swarm-text">
        {segments(entry.text).map((part, index) => (part.mark ? <mark key={index}>{part.text}</mark> : part.text))}
      </p>
    </li>
  );
}

function BoardPanel({ threadId }: { threadId: string }) {
  const { board, error, rpc } = useBoard(threadId);
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
      <ul className="swarm-members" aria-label="Members">
        {board.members.map(member =>
          // A closed swarm keeps each member's last state, which no longer describes its thread.
          board.closed ? (
            <li key={member.name}>{member.name}</li>
          ) : (
            <li key={member.name} data-run={member.run} title={`${member.name} is ${member.run}`}>
              <span className="swarm-dot" aria-hidden="true" />
              {member.name}
              <span className="swarm-run">{member.run}</span>
            </li>
          ),
        )}
      </ul>
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
            <button type="button" className="swarm-quiet" onClick={() => void report(rpc.call('close', { swarmId: board.id }))}>
              Close swarm
            </button>
            <button type="submit" disabled={!draft.trim()}>Post</button>
          </div>
        </form>
      )}
    </section>
  );
}

export default definePluginApp(app => {
  app.slots.experimental_tab({ ...boardTab, title: 'Swarm', icon: 'Bot', layout: 'flush', component: BoardPanel });

  app.commands.register({
    id: 'toggle-board',
    title: 'Toggle swarm board',
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ experimental_panel }) => {
      experimental_panel.toggleTab({ tab: boardTab, title: 'Swarm' });
    },
  });
});
