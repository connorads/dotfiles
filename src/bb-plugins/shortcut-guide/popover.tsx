import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { experimental_Icon as Icon, useSdk } from '@get-bb/plugin-sdk/app';
import { ChipPopover } from '@bb-plugins/chip';
import { catalogue, groups, keycaps, visibleCommands, type Command, type Platform, type View } from './catalogue.ts';
import { readFavourites, saveFavourites } from './preferences.ts';

function client() {
  const platform: Platform = /Mac|iPhone|iPad|iPod/u.test(navigator.platform) ? 'mac' : /Win/u.test(navigator.platform) ? 'windows' : 'linux';
  return { platform, desktop: 'bbDesktop' in window };
}
function Keys({ row, platform }: { row: Command; platform: Platform }) {
  const caps = keycaps(row.shortcut, platform);
  return caps.length ? <span className="sg-chord" aria-label={caps.join(' ')}>{caps.map((key, index) => <kbd key={index}>{key}</kbd>)}</span>
    : <span className="sg-unassigned">Unassigned</span>;
}

export function ShortcutPopover({ returnFocus, instant, onClose }: { returnFocus: HTMLElement | null; instant: boolean; onClose: () => void }) {
  const sdk = useSdk();
  const [environment] = useState(client);
  const [rows, setRows] = useState<Command[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('essentials');
  const [favourites, setFavourites] = useState(readFavourites);
  const [saveError, setSaveError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const prefix = useId();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([sdk.system.config(), sdk.plugins.list()]).then(([config, plugins]) => {
      if (live) setRows(catalogue({ bindings: config.defaultKeybindings, overrides: config.keybindingOverrides, plugins: plugins.plugins }, environment));
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, [sdk, environment, attempt]);
  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => {
    const sync = () => setFavourites(readFavourites());
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const visible = visibleCommands(rows ?? [], { query, view, favourites, platform: environment.platform });
  const ordered = groups.flatMap(group => visible.filter(row => row.group === group));
  const active = ordered.find(row => row.id === selected) ?? ordered[0];
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>('[data-selected="true"]');
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [active?.id]);
  function favourite(id: string) {
    const next = favourites.includes(id) ? favourites.filter(item => item !== id) : [...favourites, id];
    setFavourites(next);
    setSaveError(!saveFavourites(next));
  }
  function keyboard(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
    // A search input consumes Escape before the dialog's cancel event.
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); onClose(); return;
    }
    if (event.altKey && !event.metaKey && !event.ctrlKey && (event.code === 'Slash' || event.key === '/')) {
      event.preventDefault(); onClose(); return;
    }
    if (event.target === search.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const index = ordered.findIndex(row => row.id === active?.id);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setSelected(ordered[(index + direction + ordered.length) % ordered.length]?.id ?? null);
    } else if (event.target === search.current && event.key === 'Enter' && active) {
      event.preventDefault(); onClose();
    } else if (event.target === search.current && event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey) && active) {
      event.preventDefault(); favourite(active.id);
    }
  }
  const closeLabel = environment.platform === 'mac' ? '⌘S' : 'Ctrl+S';
  return <ChipPopover ref={dialog} aria-label="Shortcut guide" trigger={() => returnFocus?.isConnected ? returnFocus : null}
    anchor={null} width={600} instant={instant} panelClassName="sg-panel" onClose={onClose} onKeyDown={keyboard}
    place={() => { const width = Math.min(600, window.innerWidth - 24); return { top: Math.max(12, Math.round(window.innerHeight * .1)), left: (window.innerWidth - width) / 2, width, origin: 'top center' }; }}>
    <header className="sg-header">
      <div className="sg-title"><Icon name="Keyboard" /><h2>Shortcut guide</h2></div>
      <button type="button" className="sg-close" onClick={onClose} aria-label="Close shortcut guide"><kbd>esc</kbd><Icon name="X" /></button>
    </header>
    <div className="sg-search"><Icon name="Search" /><input ref={search} type="search" value={query} aria-label="Search shortcuts"
      placeholder="Find a command or shortcut…" aria-controls={`${prefix}-list`} aria-describedby={`${prefix}-selection`}
      onChange={event => { setQuery(event.target.value); setSelected(null); }} /></div>
    <div className="sg-toolbar">
      <div className="sg-tabs" role="group" aria-label="Shortcut collection">
        {(['essentials', 'favourites', 'all'] as const).map(value => <button type="button" key={value} aria-pressed={view === value}
          onClick={() => { setView(value); setQuery(''); setSelected(null); search.current?.focus(); }}>
          {value === 'essentials' ? 'Essentials' : value === 'favourites' ? 'Favourites' : 'Browse'}
          {value === 'favourites' && favourites.length > 0 && <span>{favourites.length}</span>}
        </button>)}
      </div>
      <span className="sg-count" role="status">{query.trim() ? `${visible.length} found` : `${visible.length} shortcuts`}</span>
    </div>
    <div id={`${prefix}-list`} ref={list} className="sg-list" aria-label="Shortcuts">
      {rows === null && !error && <p className="sg-empty" role="status">Loading your shortcuts…</p>}
      {error && <div className="sg-empty" role="alert"><p>Could not load shortcuts.</p><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
      {rows !== null && !error && ordered.length === 0 && <p className="sg-empty">{query.trim() ? 'No matching shortcuts. Try a command name, “git” or “alt”.'
        : 'Star shortcuts in Essentials or Browse to keep them here.'}</p>}
      {groups.map(group => {
        const commands = ordered.filter(row => row.group === group);
        if (!commands.length) return null;
        return <section key={group} aria-label={group} className="sg-group"><h3>{group}<span>{commands.length}</span></h3>
          {commands.map(row => <div className="sg-row" key={row.id} data-selected={row.id === active?.id || undefined}>
            <button type="button" className="sg-command" onFocus={() => setSelected(row.id)} onPointerMove={() => setSelected(row.id)}
              onClick={onClose} aria-label={`Practise ${row.title}`}>
              <span className="sg-copy"><span className="sg-name">{row.title}</span><span className="sg-description">{row.description}</span></span>
              <Keys row={row} platform={environment.platform} />
            </button>
            <button type="button" className="sg-star" aria-label={`Favourite ${row.title}`} aria-pressed={favourites.includes(row.id)}
              title={favourites.includes(row.id) ? 'Remove from favourites' : 'Add to favourites'} onClick={() => favourite(row.id)}><Icon name="Star" /></button>
          </div>)}
        </section>;
      })}
    </div>
    <footer className="sg-footer">
      <span id={`${prefix}-selection`} className="sg-practise" aria-live="polite">{active
        ? active.shortcut ? <><span>{active.title}</span><span>Close, then press</span><Keys row={active} platform={environment.platform} /></>
          : <>{active.title}: assign a shortcut in Settings → Keyboard.</>
        : <>Hold {environment.platform === 'mac' ? '⌘' : 'Ctrl'} for hints beside controls.</>}</span>
      <span className="sg-help"><span><kbd>↑</kbd><kbd>↓</kbd> browse</span><span><kbd>{closeLabel}</kbd> star</span><span><kbd>↵</kbd> close</span></span>
    </footer>
    {saveError && <p className="sg-save-error" role="status">Favourites are kept for this session. Browser storage is unavailable.</p>}
  </ChipPopover>;
}
