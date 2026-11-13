import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { choose, close, loadConnectors, message, setProjectDefault, useConnectors, visibleChip, type Open } from './store.ts';

type Row = { id: string; keycap: string; value: string; label: string; aside: string };
const PREVIEW = 14;

export function ConnectorsPopover({ open }: { open: NonNullable<Open> }) {
  const { view, threads, drafts, connectors } = useConnectors();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { target } = open;
  const current = target.kind === 'thread' ? threads.get(target.threadId) : drafts.get(target.projectId);
  const own = current?.own ?? null;
  const resolved = current?.resolved;
  const project = view?.projects.find(p => p.id === target.projectId);
  const inherited = project?.choice ?? view?.defaultChoice ?? 'off';
  const inheritedFrom = project?.choice ? 'project default' : 'global default';
  const profiles = view?.profiles ?? [];
  const [focused, setFocused] = useState<string | null>(resolved?.profile ?? null);

  useEffect(() => { profiles.forEach(p => void loadConnectors(p)); }, [profiles.join('|')]);

  const count = (profile: string) => {
    const c = connectors.get(profile);
    return !c || c === 'loading' ? '…' : c.error ? 'not available' : `${c.list.length} connectors`;
  };
  const rows: Row[] = [
    ...profiles.slice(0, 9).map((p, i) => ({ id: `p:${p}`, keycap: String(i + 1), value: p, label: p, aside: count(p) })),
    { id: 'inherit', keycap: 'i', value: 'inherit', label: `Use ${inheritedFrom}`, aside: inherited === 'off' ? 'off' : inherited },
    { id: 'off', keycap: 'o', value: 'off', label: 'Off', aside: 'no connector tools' },
  ];
  const pressed = own === null ? 'inherit' : own === 'off' ? 'off' : `p:${own}`;

  const focusRow = useCallback((id: string) => {
    dialog.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }, []);
  const didFocus = useRef(false);
  useEffect(() => {
    if (!view || !current || didFocus.current) return;
    didFocus.current = true;
    focusRow(pressed);
  }, [view, current, pressed, focusRow]);

  async function pick(row: Row) {
    setError(null);
    try { await choose(target, row.value); close(); } catch (cause) { setError(message(cause)); }
  }
  async function makeProjectDefault() {
    const profile = focused ?? resolved?.profile;
    if (!profile) return;
    setError(null);
    try { await setProjectDefault(target.projectId, profile); } catch (cause) { setError(message(cause)); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const index = rows.findIndex(r => r.id === (event.target as HTMLElement).dataset['row']);
    const move = (step: number) => { const next = rows[(Math.max(index, 0) + step + rows.length) % rows.length]; if (next) focusRow(next.id); };
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); move(-1); return; }
    if (event.key === 'p') { event.preventDefault(); void makeProjectDefault(); return; }
    const byKey = rows.find(r => r.keycap === event.key);
    if (byKey) { event.preventDefault(); void pick(byKey); }
  }

  const preview = focused ? connectors.get(focused) : undefined;
  const projectDefaultTarget = focused ?? resolved?.profile ?? null;

  return <ChipPopover ref={dialog} aria-label="Claude connectors" trigger={visibleChip} anchor={open.anchor} width={380}
    instant={open.instant} panelClassName="cc-panel" className="cc-dialog" onKeyDown={onKeyDown} onClose={close}>
    <header className="cc-header">
      <h2>Claude connectors</h2>
      <span className="cc-muted">{target.kind === 'thread' ? 'for this thread' : 'for the new thread'}</span>
    </header>
    {!view ? <p className="cc-empty">Loading…</p>
      : profiles.length === 0 ? <p className="cc-empty">No Claude profiles found. Check the profile root in Settings → Claude Connectors.</p>
      : <section className="cc-rows" aria-label="Profiles">
        {rows.map(row => <button key={row.id} type="button" className="cc-row" data-row={row.id} aria-pressed={row.id === pressed}
          onFocus={() => setFocused(row.id.startsWith('p:') ? row.value : row.value === 'inherit' && inherited !== 'off' ? inherited : null)}
          onMouseEnter={() => setFocused(row.id.startsWith('p:') ? row.value : row.value === 'inherit' && inherited !== 'off' ? inherited : null)}
          onClick={() => void pick(row)}>
          <kbd>{row.keycap}</kbd>
          <span className="cc-row-label">{row.label}</span>
          <span className="cc-row-aside">{row.aside}{row.id === pressed && <span className="cc-check" aria-hidden> ✓</span>}</span>
        </button>)}
      </section>}
    {focused && <section className="cc-preview" aria-label={`${focused} connectors`}>
      {preview === undefined || preview === 'loading' ? <span className="cc-muted">Loading {focused}'s connectors…</span>
        : preview.error ? <span className="cc-error">{preview.error}</span>
        : <>{preview.list.slice(0, PREVIEW).map(name => <span key={name} className="cc-tag">{name}</span>)}
          {preview.list.length > PREVIEW && <span className="cc-muted">+{preview.list.length - PREVIEW} more</span>}</>}
    </section>}
    {error && <p className="cc-error cc-pad" role="alert">{error}</p>}
    <footer className="cc-footer">
      <span className="cc-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose <kbd>esc</kbd> close</span>
      {projectDefaultTarget && <button type="button" className="cc-link" onClick={() => void makeProjectDefault()}>
        <kbd>p</kbd> Make {projectDefaultTarget} this project's default{project?.choice === projectDefaultTarget ? ' ✓' : ''}
      </button>}
      <span>{target.kind === 'thread' ? 'A thread that was off gets the tools from its next message.' : 'Applies when you send the first message.'}
        {' '}Write tools are off until allowed in Settings → Claude Connectors.</span>
    </footer>
  </ChipPopover>;
}
