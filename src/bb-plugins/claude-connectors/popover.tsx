import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import { Retry } from './retry.tsx';
import { inScope } from './src/choice.ts';
import { choose, close, loadConnectors, loadKey, save, setOnly, setProjectDefault, setShare, useConnectors, visibleChip, type Open } from './store.ts';
import { ToolsPanel } from './tools-panel.tsx';

type Row = { id: string; keycap: string; value: string; label: string; aside: string; warn?: boolean; dividerBefore?: boolean };
const PREVIEW = 14;
const HOVER_REST = 150;
const DEFAULT_ROW = 'default:';
const ONLY_ROW = 'only';
const SHARE_ROW = 'share';

/** Names the change a failed save tried to make, from its save row. */
function failedChange(row: string, inheritedFrom: string) {
  if (row === ONLY_ROW) return 'Could not change this thread\'s connectors.';
  if (row === SHARE_ROW) return 'Could not change what workers get.';
  if (row.startsWith(DEFAULT_ROW)) return `Could not update this project's default.`;
  if (row.startsWith('p:')) return `Could not switch to ${row.slice(2)}.`;
  return row === 'inherit' ? `Could not switch to the ${inheritedFrom}.` : 'Could not turn connectors off.';
}

export function ConnectorsPopover({ open }: { open: NonNullable<Open> }) {
  const { view, threads, drafts, connectors, stateError, loadErrors, saves } = useConnectors();
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(hover.current); }; }, []);
  const { target } = open;
  const pending = saves.get(loadKey(target));
  const saving = pending && pending.error === null ? pending.row : null;
  const error = pending?.error ?? null;
  const current = target.kind === 'thread' ? threads.get(target.threadId) : drafts.get(target.projectId);
  const loadError = current ? undefined : loadErrors.get(loadKey(target))?.error;
  const own = current?.own ?? null;
  const resolved = current?.resolved;
  const project = view?.projects.find(p => p.id === target.projectId);
  const isOwnerInherited = target.kind === 'thread' && resolved?.source === 'owner';
  const inherited = isOwnerInherited ? (resolved.profile ?? 'off') : (project?.choice ?? view?.defaultChoice ?? 'off');
  const inheritedFrom = isOwnerInherited ? 'parent thread' : (project?.choice ? 'project default' : 'global default');
  const profiles = view?.profiles ?? [];
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  const [toolsView, setToolsView] = useState<{ profile: string; connector?: string } | null>(null);
  const profileOf = (id: string) => id.startsWith('p:') ? id.slice(2) : id === 'inherit' && inherited !== 'off' ? inherited : null;
  const focused = focusedRow === null ? resolved?.profile ?? null : profileOf(focusedRow);
  const rowsBox = useRef<HTMLElement>(null);

  useEffect(() => { profiles.forEach(p => void loadConnectors(p)); }, [profiles.join('|')]);

  const count = (profile: string): { text: string; warn?: boolean } => {
    const c = connectors.get(profile);
    if (!c || c === 'loading') return { text: '…' };
    if (c.error) return { text: 'not available', warn: true };
    return { text: `${c.list.length} connector${c.list.length === 1 ? '' : 's'}` };
  };

  const inheritAside = isOwnerInherited
    ? (resolved.profile ? `${resolved.profile} · read-only` : 'off · read-only')
    : (inherited === 'off' ? 'off' : inherited);

  const rows: Row[] = [
    ...profiles.map((p, i) => {
      const info = count(p);
      return { id: `p:${p}`, keycap: i < 9 ? String(i + 1) : '', value: p, label: p, aside: info.text, warn: info.warn };
    }),
    {
      id: 'inherit',
      keycap: 'i',
      value: 'inherit',
      label: isOwnerInherited ? 'Inherit from parent' : `Use ${inheritedFrom}`,
      aside: inheritAside,
      dividerBefore: profiles.length > 0,
    },
    { id: 'off', keycap: 'o', value: 'off', label: 'Off', aside: 'no connector tools' },
  ];
  const pressed = !current ? null : own === null ? 'inherit' : own === 'off' ? 'off' : `p:${own}`;

  const focusRow = useCallback((id: string) => {
    dialog.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }, []);
  const didFocus = useRef(false);
  useEffect(() => {
    if (!view || didFocus.current || !(current || loadError) || toolsView) return;
    didFocus.current = true;
    focusRow(pressed ?? rows[0]!.id);
  }, [view, current, loadError, pressed, focusRow, toolsView]);

  async function pick(row: Row) {
    if (await save(target, row.id, () => choose(target, row.value)) && mounted.current) close();
  }

  const shown = target.kind === 'thread' ? threads.get(target.threadId) : undefined;
  const thread = target.kind === 'thread' && shown ? { target, share: shown.share } : null;
  const only = resolved?.only ?? null;
  const editable = thread !== null && focused !== null && focused === resolved?.profile && resolved.source !== 'owner';

  const preview = focused ? connectors.get(focused) : undefined;
  const toolsTarget = focused ?? resolved?.profile ?? null;
  const canOpenTools = Boolean(view && toolsTarget && profiles.includes(toolsTarget));

  function openTools(profileName: string, connector?: string) {
    setToolsView({ profile: profileName, connector });
  }

  const savingDefault = saving?.startsWith(DEFAULT_ROW) ? saving.slice(DEFAULT_ROW.length) : null;
  const projectDefaultTarget = profiles.length === 0 ? null : savingDefault ?? focused ?? resolved?.profile ?? null;
  const isCurrentProjectDefault = Boolean(projectDefaultTarget && project?.choice === projectDefaultTarget);

  function toggleProjectDefault() {
    const profile = focused ?? resolved?.profile;
    if (!profile || profiles.length === 0) return;
    const nextValue = project?.choice === profile ? 'inherit' : profile;
    void save(target, DEFAULT_ROW + profile, () => setProjectDefault(target.projectId, nextValue));
  }

  function toggleConnector(name: string, all: string[]) {
    if (!thread) return;
    const next = all.filter(n => (n === name) !== inScope(only, n));
    void save(target, ONLY_ROW, () => setOnly(thread.target, next.length === all.length ? null : next));
  }

  function toggleShare() {
    if (thread) void save(target, SHARE_ROW, () => setShare(thread.target, !thread.share));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (toolsView || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as HTMLElement).closest('input, select, textarea')) return;
    clearTimeout(hover.current);
    rowsBox.current?.setAttribute('data-keys', '');
    const index = rows.findIndex(r => r.id === (event.target as HTMLElement).dataset['row']);
    const move = (step: number) => {
      const next = index < 0 ? rows[step > 0 ? 0 : rows.length - 1] : rows[(index + step + rows.length) % rows.length];
      if (next) focusRow(next.id);
    };
    if (event.key === 'ArrowDown' || event.key === 'j') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp' || event.key === 'k') { event.preventDefault(); move(-1); return; }
    if (event.key === 't' && canOpenTools && toolsTarget) { event.preventDefault(); openTools(toolsTarget); return; }
    if (event.key === 'p' && projectDefaultTarget) { event.preventDefault(); toggleProjectDefault(); return; }
    if (event.key === 'w' && thread && view) { event.preventDefault(); toggleShare(); return; }
    const byKey = rows.find(r => r.keycap === event.key);
    if (byKey) { event.preventDefault(); void pick(byKey); }
  }

  const linkText = savingDefault
    ? (isCurrentProjectDefault ? `Clearing ${savingDefault} project default…` : `Making ${savingDefault} project default…`)
    : isCurrentProjectDefault
      ? `Clear ${projectDefaultTarget} as project default`
      : `Make ${projectDefaultTarget} this project's default`;

  const enabledCount = editable && preview && preview !== 'loading' && !preview.error
    ? preview.list.filter(name => inScope(only, name)).length
    : null;

  const dialogLabel = toolsView ? `${toolsView.profile} tool permissions` : 'Claude connectors';

  return <ChipPopover ref={dialog} aria-label={dialogLabel} trigger={visibleChip} anchor={open.anchor}
    width={toolsView ? 440 : 390} instant={open.instant} panelClassName="cc-panel" className="cc-dialog"
    onKeyDown={onKeyDown} onClose={close} onEscape={toolsView ? () => setToolsView(null) : undefined}>
    <header className="cc-header">
      {toolsView ? <>
        <button type="button" className="cc-header-btn" aria-label="Back to profiles"
          onClick={() => setToolsView(null)}>← Back</button>
        <h2>{toolsView.profile} tools</h2>
        <span className="cc-muted">profile policy</span>
      </> : <>
        <h2>Claude connectors</h2>
        <div className="cc-header-right">
          {canOpenTools && toolsTarget ? <button type="button" className="cc-header-btn" data-cc-tools-trigger
            onClick={() => openTools(toolsTarget)} title={`Manage tool permissions for ${toolsTarget} (t)`}>
            <kbd>t</kbd> Tools
          </button> : <span className="cc-muted">{target.kind === 'thread' ? 'for this thread' : 'for the new thread'}</span>}
        </div>
      </>}
    </header>

    {toolsView ? <div className="cc-popover-tools">
      <ToolsPanel
        fixedProfile={toolsView.profile}
        initialConnector={toolsView.connector}
        compact
        readOnlyNotice={resolved?.readOnly && resolved.profile === toolsView.profile ? {
          profile: toolsView.profile,
          busy: saving === `p:${toolsView.profile}`,
          onUseDirectly: () => {
            void save(target, `p:${toolsView.profile}`, () => choose(target, toolsView.profile));
          },
        } : undefined}
      />
    </div> : <>
      {!view ? stateError ? <p className="cc-empty cc-error" role="alert">Could not load profiles. {stateError} <Retry /></p>
          : <p className="cc-empty">Loading…</p>
        : profiles.length === 0 ? <p className="cc-empty">No Claude profiles found. Check the profile root in Settings → Claude Connectors.</p>
        : <section ref={rowsBox} className="cc-rows" aria-label="Profiles" onMouseMove={() => rowsBox.current?.removeAttribute('data-keys')}>
          {loadError && <p className="cc-error cc-pad" role="alert">Could not load {target.kind === 'thread' ? "this thread's" : "the new thread's"} choice. {loadError}</p>}
          {rows.map(row => <div key={row.id} className={row.dividerBefore ? 'cc-row-break' : undefined}>
            <button type="button" className="cc-row" data-row={row.id} aria-pressed={row.id === pressed}
              aria-disabled={saving !== null || undefined} aria-busy={saving === row.id || undefined}
              onFocus={() => setFocusedRow(row.id)}
              onMouseEnter={event => {
                const el = event.currentTarget;
                clearTimeout(hover.current);
                if (row.id.startsWith('p:')) hover.current = setTimeout(() => el.focus({ preventScroll: true }), HOVER_REST);
              }}
              onMouseLeave={() => clearTimeout(hover.current)}
              onClick={() => void pick(row)}>
              {row.keycap ? <kbd>{row.keycap}</kbd> : <span />}
              <span className="cc-row-label">{row.label}</span>
              <span className="cc-row-aside" data-warn={row.warn ? '' : undefined}>
                {saving === row.id ? 'Saving…' : row.aside}
                {row.id === pressed && <span className="cc-check" aria-hidden> ✓</span>}
              </span>
            </button>
          </div>)}
        </section>}

      {view && profiles.length > 0 && <section className="cc-preview" aria-label={focused ? `${focused} connectors` : 'Connectors'}>
        {error && pending && <p className="cc-error cc-save-error" role="alert">{failedChange(pending.row, inheritedFrom)} {error}</p>}
        {!focused ? <span className="cc-muted">No connector tools.</span>
          : preview === undefined || preview === 'loading' ? <span className="cc-muted">Loading {focused}'s connectors…</span>
          : preview.error ? <span className="cc-error">{preview.error} <Retry /></span>
          : <>
            <div className="cc-preview-head">
              <span className="cc-muted">
                {editable
                  ? `Thread scope (${enabledCount}/${preview.list.length} on · click to toggle)`
                  : isOwnerInherited && focused === resolved?.profile
                    ? `${focused} connectors · inherited read-only`
                    : `${focused} connectors`}
              </span>
            </div>
            <div className="cc-tags">
              {editable ? preview.list.map(name => {
                const active = inScope(only, name);
                return <button key={name} type="button" className="cc-tag cc-tag-toggle" aria-pressed={active}
                  aria-disabled={saving !== null || undefined}
                  title={`${active ? 'Turn off' : 'Turn on'} ${name} for this thread`}
                  onClick={() => toggleConnector(name, preview.list)}>
                  <span className="cc-tag-dot" aria-hidden />{name}
                </button>;
              }) : <>
                {preview.list.slice(0, PREVIEW).map(name => <span key={name} className="cc-tag">{name}</span>)}
                {preview.list.length > PREVIEW && <span className="cc-muted">+{preview.list.length - PREVIEW} more</span>}
              </>}
            </div>
          </>}
      </section>}

      {view && profiles.length > 0 && <footer className="cc-footer">
        <span className="cc-keys"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose <kbd>t</kbd> tools <kbd>esc</kbd> close</span>
        {projectDefaultTarget ? <button type="button" className="cc-link" onClick={toggleProjectDefault}
          aria-disabled={saving !== null || undefined} aria-busy={savingDefault !== null || undefined} title={linkText}>
          <kbd>p</kbd> {linkText}
        </button> : <span className="cc-link cc-link-idle" aria-hidden><kbd>p</kbd></span>}
        {thread && <button type="button" className="cc-link" aria-pressed={thread.share} onClick={toggleShare}
          aria-disabled={saving !== null || undefined} aria-busy={saving === SHARE_ROW || undefined}>
          <kbd>w</kbd> {thread.share ? 'Workers inherit these connectors, read-only ✓' : 'Workers inherit no connectors'}
        </button>}
        <span className="cc-footer-note">
          {target.kind === 'draft'
            ? 'Applies on the first message. Manage write permissions in Tools.'
            : isOwnerInherited
              ? 'Read-only from parent thread. Pick a profile above to allow writes here.'
              : 'Write tools stay off until allowed in Tools.'}
        </span>
      </footer>}
    </>}
  </ChipPopover>;
}
