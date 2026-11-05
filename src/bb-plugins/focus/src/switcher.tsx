import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { FocusView } from '../contracts.ts';
import { listKey } from './keys.ts';

export interface SwitcherActions {
  activate: (setId: string | null) => Promise<unknown>;
  create: () => Promise<FocusView>;
  rename: (setId: string, name: string) => Promise<unknown>;
  remove: (setId: string) => Promise<unknown>;
  setProject: (setId: string, projectId: string, included: boolean) => Promise<unknown>;
  setMask: (setId: string, mask: 'off' | 'hide-rest') => Promise<unknown>;
  close: () => void;
}

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export function Switcher({ view, actions }: { view: FocusView; actions: SwitcherActions }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const run = (call: Promise<unknown>) => { call.then(() => setError(null), cause => setError(message(cause))); };
  const set = view.sets.find(candidate => candidate.id === editing);

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, []);

  // Tab stays inside the dialog.
  const trap = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>('button, input'));
    const first = items[0];
    const last = items[items.length - 1];
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === dialog.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && current === last) { event.preventDefault(); first?.focus(); }
  };

  // No aria-modal: BB's `modalOpen` context would block the shortcut's second press.
  return <div className="fx-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) actions.close(); }}>
    <div ref={dialog} className="fx-card" role="dialog" aria-label="Focus sets" tabIndex={-1} onKeyDown={trap}>
      {set
        ? <Editor key={set.id} set={set} projects={view.projects} actions={actions} run={run}
            back={() => setEditing(null)} />
        : <List view={view} actions={actions} run={run} edit={setEditing} />}
      {error && <p className="fx-note" role="alert">{error}</p>}
    </div>
  </div>;
}

function List({ view, actions, run, edit }: {
  view: FocusView;
  actions: SwitcherActions;
  run: (call: Promise<unknown>) => void;
  edit: (setId: string) => void;
}) {
  const rows = view.sets.length + 2;
  const [row, setRow] = useState(view.sets.findIndex(set => set.id === view.activeSetId) + 1);
  const list = useRef<HTMLDivElement>(null);
  const choose = (target: number) => {
    if (target === rows - 1) { run(actions.create().then(next => { const made = next.sets[next.sets.length - 1]; if (made) edit(made.id); })); return; }
    actions.close();
    run(actions.activate(view.sets[target - 1]?.id ?? null));
  };

  useEffect(() => { list.current?.closest<HTMLElement>('[role="dialog"]')?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const action = listKey(event.key, row, rows);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action.kind === 'move') setRow(action.row);
      else if (action.kind === 'choose') choose(action.row);
      else if (action.kind === 'close') actions.close();
      else { const set = view.sets[action.row - 1]; if (set) edit(set.id); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const summary = (set: FocusView['sets'][number]) => {
    const count = set.projects.length;
    const projects = count === 0 ? 'No projects' : count === 1 ? '1 project' : `${count} projects`;
    return set.mask === 'hide-rest' ? `${projects} · hides the rest` : projects;
  };

  return <div ref={list} className="fx-scroll" role="listbox" aria-label="Focus sets">
    <Row index={0} label="Off" detail="All projects" current={view.activeSetId === null} highlighted={row === 0}
      onHover={() => setRow(0)} onChoose={() => choose(0)} />
    {view.sets.map((set, index) => <Row key={set.id} index={index + 1} label={set.name} detail={summary(set)}
      current={view.activeSetId === set.id} highlighted={row === index + 1}
      onHover={() => setRow(index + 1)} onChoose={() => choose(index + 1)} onEdit={() => edit(set.id)} />)}
    <Row label="New set" current={false} highlighted={row === rows - 1} onHover={() => setRow(rows - 1)} onChoose={() => choose(rows - 1)} />
  </div>;
}

function Row({ index, label, detail, current, highlighted, onHover, onChoose, onEdit }: {
  index?: number;
  label: string;
  detail?: string;
  current: boolean;
  highlighted: boolean;
  onHover: () => void;
  onChoose: () => void;
  onEdit?: () => void;
}) {
  return <div className="fx-row" data-highlighted={highlighted || undefined} onMouseMove={onHover}>
    <button type="button" className="fx-choose" role="option" aria-selected={current} onClick={onChoose}>
      <kbd className="fx-key">{index ?? '+'}</kbd>
      <span className="fx-label">
        <span className="fx-name">{label}</span>
        {detail && <span className="fx-detail">{detail}</span>}
      </span>
      {current && <span className="fx-current">On</span>}
    </button>
    {onEdit && <button type="button" className="fx-edit" aria-label={`Edit ${label}`} onClick={onEdit}>Edit</button>}
  </div>;
}

function Editor({ set, projects, actions, run, back }: {
  set: FocusView['sets'][number];
  projects: FocusView['projects'];
  actions: SwitcherActions;
  run: (call: Promise<unknown>) => void;
  back: () => void;
}) {
  const [name, setName] = useState(set.name);
  const [query, setQuery] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const saveName = () => { if (name.trim() && name !== set.name) run(actions.rename(set.id, name)); };
  const leave = () => { saveName(); back(); };
  const shown = projects.filter(project => project.name.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => { nameInput.current?.focus(); nameInput.current?.select(); }, []);

  return <div className="fx-editor" onKeyDown={event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    leave();
  }}>
    <div className="fx-editor-head">
      <button type="button" className="fx-edit" onClick={leave}>Back</button>
      <input ref={nameInput} className="fx-input" aria-label="Set name" maxLength={40} value={name}
        onChange={event => setName(event.target.value)} onBlur={saveName}
        onKeyDown={event => { if (event.key === 'Enter') leave(); }} />
    </div>
    <label className="fx-toggle">
      <input type="checkbox" checked={set.mask === 'hide-rest'}
        onChange={event => run(actions.setMask(set.id, event.target.checked ? 'hide-rest' : 'off'))} />
      Hide More and Pinned
    </label>
    <input className="fx-input" type="search" aria-label="Filter projects" placeholder="Filter projects" value={query}
      onChange={event => setQuery(event.target.value)} />
    <div className="fx-scroll">
      {shown.map(project => <label key={project.id} className="fx-toggle">
        <input type="checkbox" checked={set.projects.includes(project.id)}
          onChange={event => run(actions.setProject(set.id, project.id, event.target.checked))} />
        <span className="fx-name">{project.name}</span>
      </label>)}
      {shown.length === 0 && <p className="fx-note">No projects match.</p>}
    </div>
    <button type="button" className="fx-delete" onClick={() => { back(); run(actions.remove(set.id)); }}>Delete set</button>
  </div>;
}
