import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { Retry } from './retry.tsx';
import { choose, close, loadConnectors, loadKey, save, setProjectDefault, useConnectors, visibleChip, type Open } from './store.ts';

type Row = { id: string; keycap: string; value: string; label: string; aside: string };
const PREVIEW = 14;
const HOVER_REST = 150;
/** The save row for `p`, which names the profile being made the project default. */
const DEFAULT_ROW = 'default:';

export function ConnectorsPopover({ open }: { open: NonNullable<Open> }) {
  const { view, threads, drafts, connectors, stateError, loadErrors, saves } = useConnectors();
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  /** Hover focuses a profile row only once the pointer rests on it, so passing over rows on the way to
   *  the footer link does not change the profile the link names. "Use … default" and "Off" sit between
   *  the profiles and the link, so hovering them only highlights. */
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(hover.current); }; }, []);
  const { target } = open;
  const pending = saves.get(loadKey(target));
  /** The row being saved; further picks wait for it, in this popover or a reopened one. */
  const saving = pending && pending.error === null ? pending.row : null;
  const error = pending?.error ?? null;
  const current = target.kind === 'thread' ? threads.get(target.threadId) : drafts.get(target.projectId);
  const loadError = current ? undefined : loadErrors.get(loadKey(target))?.error;
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
    return !c || c === 'loading' ? '…' : c.error ? 'not available' : `${c.list.length} connector${c.list.length === 1 ? '' : 's'}`;
  };
  const rows: Row[] = [
    ...profiles.map((p, i) => ({ id: `p:${p}`, keycap: i < 9 ? String(i + 1) : '', value: p, label: p, aside: count(p) })),
    { id: 'inherit', keycap: 'i', value: 'inherit', label: `Use ${inheritedFrom}`, aside: inherited === 'off' ? 'off' : inherited },
    { id: 'off', keycap: 'o', value: 'off', label: 'Off', aside: 'no connector tools' },
  ];
  const pressed = !current ? null : own === null ? 'inherit' : own === 'off' ? 'off' : `p:${own}`;

  const focusRow = useCallback((id: string) => {
    dialog.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }, []);
  const didFocus = useRef(false);
  useEffect(() => {
    if (!view || didFocus.current || !(current || loadError)) return;
    didFocus.current = true;
    focusRow(pressed ?? rows[0]!.id);
  }, [view, current, loadError, pressed, focusRow]);

  async function pick(row: Row) {
    if (await save(target, row.id, () => choose(target, row.value)) && mounted.current) close();
  }
  function makeProjectDefault() {
    const profile = focused ?? resolved?.profile;
    if (profile && profiles.length > 0) void save(target, DEFAULT_ROW + profile, () => setProjectDefault(target.projectId, profile));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const index = rows.findIndex(r => r.id === (event.target as HTMLElement).dataset['row']);
    const move = (step: number) => { const next = rows[(Math.max(index, 0) + step + rows.length) % rows.length]; if (next) focusRow(next.id); };
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); move(-1); return; }
    if (event.key === 'p') { event.preventDefault(); makeProjectDefault(); return; }
    const byKey = rows.find(r => r.keycap === event.key);
    if (byKey) { event.preventDefault(); void pick(byKey); }
  }

  const preview = focused ? connectors.get(focused) : undefined;
  const savingDefault = saving?.startsWith(DEFAULT_ROW) ? saving.slice(DEFAULT_ROW.length) : null;
  const projectDefaultTarget = profiles.length === 0 ? null : savingDefault ?? focused ?? resolved?.profile ?? null;

  return <ChipPopover ref={dialog} aria-label="Claude connectors" trigger={visibleChip} anchor={open.anchor} width={380}
    instant={open.instant} panelClassName="cc-panel" className="cc-dialog" onKeyDown={onKeyDown} onClose={close}>
    <header className="cc-header">
      <h2>Claude connectors</h2>
      <span className="cc-muted">{target.kind === 'thread' ? 'for this thread' : 'for the new thread'}</span>
    </header>
    {!view ? stateError ? <p className="cc-empty cc-error" role="alert">Could not load profiles. {stateError} <Retry /></p>
        : <p className="cc-empty">Loading…</p>
      : profiles.length === 0 ? <p className="cc-empty">No Claude profiles found. Check the profile root in Settings → Claude Connectors.</p>
      : <section className="cc-rows" aria-label="Profiles">
        {loadError && <p className="cc-error cc-pad" role="alert">Could not load {target.kind === 'thread' ? "this thread's" : "the new thread's"} choice. {loadError}</p>}
        {rows.map(row => <button key={row.id} type="button" className="cc-row" data-row={row.id} aria-pressed={row.id === pressed}
          aria-disabled={saving !== null || undefined} aria-busy={saving === row.id || undefined}
          onFocus={() => setFocused(row.id.startsWith('p:') ? row.value : row.value === 'inherit' && inherited !== 'off' ? inherited : null)}
          onMouseEnter={event => {
            const el = event.currentTarget;
            clearTimeout(hover.current);
            if (row.id.startsWith('p:')) hover.current = setTimeout(() => el.focus({ preventScroll: true }), HOVER_REST);
          }}
          onMouseLeave={() => clearTimeout(hover.current)}
          onClick={() => void pick(row)}>
          {row.keycap ? <kbd>{row.keycap}</kbd> : <span />}
          <span className="cc-row-label">{row.label}</span>
          <span className="cc-row-aside">{saving === row.id ? 'Saving…' : row.aside}{row.id === pressed && <span className="cc-check" aria-hidden> ✓</span>}</span>
        </button>)}
      </section>}
    {focused && view && <section className="cc-preview" aria-label={`${focused} connectors`}>
      {preview === undefined || preview === 'loading' ? <span className="cc-muted">Loading {focused}'s connectors…</span>
        : preview.error ? <span className="cc-error">{preview.error}</span>
        : <>{preview.list.slice(0, PREVIEW).map(name => <span key={name} className="cc-tag">{name}</span>)}
          {preview.list.length > PREVIEW && <span className="cc-muted">+{preview.list.length - PREVIEW} more</span>}</>}
    </section>}
    {error && <p className="cc-error cc-pad cc-save-error" role="alert">Could not save the change. {error}</p>}
    <footer className="cc-footer">
      {profiles.length > 0 && <span className="cc-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose <kbd>esc</kbd> close</span>}
      {projectDefaultTarget && <button type="button" className="cc-link" onClick={makeProjectDefault}
        aria-disabled={saving !== null || undefined} aria-busy={savingDefault !== null || undefined}>
        <kbd>p</kbd> {savingDefault ? `Making ${savingDefault} this project's default…`
          : <>Make {projectDefaultTarget} this project's default{project?.choice === projectDefaultTarget ? ' ✓' : ''}</>}
      </button>}
      <span>{target.kind === 'thread' ? 'A thread that was off gets the tools from its next message.' : 'Applies when you send the first message.'}
        {' '}Write tools are off until allowed in Settings → Claude Connectors.</span>
    </footer>
  </ChipPopover>;
}
