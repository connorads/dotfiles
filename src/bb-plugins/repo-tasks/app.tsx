import { useCallback, useEffect, useRef, useState } from 'react';
import {
  definePluginApp,
  useBbContext,
  useRpc,
  experimental_FileLink as FileLink,
  Markdown,
  UrlLink,
} from '@get-bb/plugin-sdk/app';
import type { rpcContract, Project, Snapshot } from './contracts.ts';
import {
  agendaGroup,
  agendaGroups,
  dateKey,
  localToday,
  type Task,
} from './src/tasks.ts';
import './app.css';

type Filter = 'all' | 'attention' | 'waiting' | 'triage';
type View = 'agenda' | 'board';
const labels: Record<Filter, string> = {
  all: 'All tasks',
  attention: 'Coming up',
  waiting: 'Waiting',
  triage: 'To triage',
};
const states = [
  { id: 'next', label: 'Next' },
  { id: 'doing', label: 'Doing' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'triage', label: 'Triage' },
] as const;
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
function Glyph({
  name,
}: {
  name:
    | 'search'
    | 'agenda'
    | 'board'
    | 'refresh'
    | 'close'
    | 'arrow'
    | 'clock'
    | 'inbox'
    | 'source';
}) {
  const paths = {
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    agenda: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    board: 'M3 4h7v16H3zM14 4h7v16h-7z',
    refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M18 18a8 8 0 0 1-14-6',
    close: 'M6 6l12 12M6 18L18 6',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    inbox: 'M4 4h16l2 12v4H2v-4L4 4M2 16h6l2 3h4l2-3h6',
    source: 'M14 2H5v20h14V7l-5-5M14 2v5h5M8 12h8M8 16h6',
  };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
function onlySafeLinks(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\((?!https?:\/\/)[^)]+\)/g, '$1');
}
function useTasks(projectId: string, sourceId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    if (!projectId || document.visibilityState === 'hidden') return;
    const request = ++latest.current;
    setLoading(true);
    try {
      const next = await rpc.call('snapshot', { projectId, sourceId });
      if (request !== latest.current) return;
      if (next.error) {
        setError(next.error);
        setSnapshot((previous) => previous ?? next);
      } else {
        setSnapshot(next);
        setError(null);
      }
    } catch (cause) {
      if (request === latest.current) setError(message(cause));
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [rpc, projectId, sourceId]);
  useEffect(() => {
    setSnapshot(null);
    setError(null);
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 15000);
    const visible = () => {
      void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      ++latest.current;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh]);
  return { snapshot, error, loading, refresh };
}
function taskMatches(task: Task, filter: Filter, today: string): boolean {
  if (filter === 'waiting') return task.state === 'waiting';
  if (filter === 'triage') return task.state === 'triage';
  return (
    filter === 'all' ||
    ['Past dates', 'Today', 'Next 7 days'].includes(agendaGroup(task, today))
  );
}
function TaskRow({
  task,
  selected,
  today,
  view,
  onOpen,
}: {
  task: Task;
  selected: boolean;
  today: string;
  view: View;
  onOpen: () => void;
}) {
  const past = agendaGroup(task, today) === 'Past dates';
  return (
    <button
      className={`rt-task rt-${view === 'board' ? 'card' : 'row'}`}
      data-task={task.id}
      data-selected={selected}
      onClick={onOpen}
    >
      <span
        className={`rt-state rt-state-${task.state}`}
        aria-label={task.state}
      />
      <span className="rt-task-copy">
        <span className="rt-task-title">{task.title}</span>
        <span className="rt-task-meta">
          <span className="rt-area">{task.area}</span>
          {task.state === 'waiting' && (
            <>
              <span className="rt-separator">·</span>
              <span>Waiting</span>
            </>
          )}
          {view === 'board' && task.date.kind !== 'none' && (
            <span className="rt-card-date" data-past={past}>
              {task.date.label}
            </span>
          )}
        </span>
      </span>
      {view === 'agenda' && (
        <span className="rt-date" data-past={past}>
          {task.date.kind === 'none' ? '' : task.date.label}
        </span>
      )}
      <span className="rt-row-arrow">
        <Glyph name="arrow" />
      </span>
    </button>
  );
}
function Context({ task, snapshot }: { task: Task; snapshot: Snapshot }) {
  const rpc = useRpc<typeof rpcContract>();
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      ++request.current;
    },
    [],
  );
  async function read(next: string) {
    if (path === next) {
      ++request.current;
      setPath(null);
      setContent(null);
      return;
    }
    const id = ++request.current;
    setPath(next);
    setContent(null);
    setError(null);
    try {
      const result = await rpc.call('context', {
        projectId: snapshot.projectId,
        sourceId: snapshot.source?.id ?? null,
        taskId: task.id,
        path: next,
      });
      if (id === request.current) setContent(result.content);
    } catch (cause) {
      if (id === request.current) setError(message(cause));
    }
  }
  return (
    <>
      {task.links.length > 0 && (
        <section className="rt-context">
          <h3>Source context</h3>
          {task.links.map((link, i) => (
            <div className="rt-context-item" key={i}>
              {link.path ? (
                <>
                  <button
                    className="rt-context-toggle"
                    aria-expanded={path === link.path}
                    onClick={() => {
                      if (link.path) void read(link.path);
                    }}
                  >
                    <Glyph name="source" />
                    <span>
                      {link.label}
                      <small>{link.path}</small>
                    </span>
                    <span>{path === link.path ? '−' : '+'}</span>
                  </button>
                  {snapshot.source && (
                    <FileLink
                      className="rt-open-source"
                      target={{
                        kind: 'host',
                        hostId: snapshot.source.hostId,
                        path: `${snapshot.source.path}/${link.path}`,
                      }}
                    >
                      Open file ↗
                    </FileLink>
                  )}
                </>
              ) : /^https?:\/\//.test(link.url) ? (
                <UrlLink className="rt-external" href={link.url}>
                  {link.label} ↗
                </UrlLink>
              ) : (
                <span>{link.label}</span>
              )}
              {link.path && path === link.path && (
                <div className="rt-context-body">
                  {error ? (
                    <p role="alert">{error}</p>
                  ) : content === null ? (
                    <p className="rt-muted">Reading source…</p>
                  ) : (
                    <Markdown content={onlySafeLinks(content)} />
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
function Detail({
  task,
  snapshot,
  onClose,
}: {
  task: Task;
  snapshot: Snapshot;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);
  return (
    <aside className="rt-detail" role="region" aria-label="Task details">
      <div className="rt-detail-top">
        <button
          className="rt-icon-button"
          aria-label="Close task details"
          onClick={onClose}
        >
          <Glyph name="close" />
        </button>
        <span className="rt-eyebrow">{task.area}</span>
      </div>
      <h2 ref={heading} tabIndex={-1}>
        {task.title}
      </h2>
      <div className="rt-properties">
        <span>Status</span>
        <strong>{states.find((s) => s.id === task.state)?.label}</strong>
        <span>Date</span>
        <strong>{task.date.label}</strong>
        <span>Section</span>
        <strong>{task.section}</strong>
      </div>
      <section className="rt-original">
        <h3>As written</h3>
        <Markdown content={onlySafeLinks(task.raw)} />
      </section>
      <Context task={task} snapshot={snapshot} />
      {snapshot.source && (
        <FileLink
          className="rt-origin"
          target={{
            kind: 'host',
            hostId: snapshot.source.hostId,
            path: `${snapshot.source.path}/${task.path}`,
          }}
          location={{ kind: 'line', line: task.line, column: null }}
        >
          {task.path}:{task.line} ↗
        </FileLink>
      )}
    </aside>
  );
}
function SourceForm({
  projectId,
  taskFile,
  onSaved,
  onClose,
}: {
  projectId: string;
  taskFile: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [value, setValue] = useState(taskFile);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="rt-source-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        try {
          await rpc.call('configure', { projectId, taskFile: value });
          onSaved();
          onClose();
        } catch (cause) {
          setError(message(cause));
        } finally {
          setPending(false);
        }
      }}
    >
      <label htmlFor="rt-source-path">Task file for this project</label>
      <div>
        <input
          id="rt-source-path"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="TODO.md"
        />
        <button disabled={pending} type="submit">
          {pending ? 'Saving…' : 'Use file'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p>Relative to the selected checkout. Changes plugin settings only.</p>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function TasksPage() {
  const rpc = useRpc<typeof rpcContract>();
  const context = useBbContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState('');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<View>('agenda');
  const [area, setArea] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const { snapshot, error, loading, refresh } = useTasks(projectId, sourceId);
  const today = localToday();
  useEffect(() => {
    let active = true;
    rpc.call('projects', {}).then(
      (result) => {
        if (!active) return;
        setProjects(result.projects);
        const saved = localStorage.getItem('repo-tasks:project');
        const initial =
          result.projects.find((p) => p.id === context.projectId) ??
          result.projects.find((p) => p.id === saved) ??
          result.projects[0];
        if (initial) setProjectId(initial.id);
      },
      (cause) => {
        if (active) setProjectsError(message(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [rpc, context.projectId]);
  const project = projects.find((p) => p.id === projectId);
  const tasks = snapshot?.tasks ?? [];
  const filtered = tasks.filter(
    (task) =>
      taskMatches(task, filter, today) &&
      (!area || task.area === area) &&
      `${task.title} ${task.area} ${task.raw}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const opened = tasks.find((task) => task.id === selected);
  const closeDetail = useCallback(() => {
    setSelected(null);
    requestAnimationFrame(() => {
      if (selected)
        document
          .querySelector<HTMLButtonElement>(
            `[data-task="${CSS.escape(selected)}"]`,
          )
          ?.focus();
    });
  }, [selected]);
  function chooseProject(id: string) {
    setProjectId(id);
    setSourceId(null);
    setSelected(null);
    setSourceOpen(false);
    setArea('');
    setSearch('');
    localStorage.setItem('repo-tasks:project', id);
  }
  const groupLabels =
    view === 'agenda'
      ? agendaGroups
      : states
          .filter(
            (s) => s.id !== 'doing' || tasks.some((t) => t.state === 'doing'),
          )
          .map((s) => s.label);
  const filteredGroups = groupLabels
    .map((label) => ({
      label,
      tasks: filtered
        .filter((task) =>
          view === 'agenda'
            ? agendaGroup(task, today) === label
            : states.find((s) => s.id === task.state)?.label === label,
        )
        .sort(
          (a, b) => dateKey(a).localeCompare(dateKey(b)) || a.line - b.line,
        ),
    }))
    .filter((group) => view === 'board' || group.tasks.length);
  const fresh = snapshot?.readAt
    ? new Date(snapshot.readAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  return (
    <div className="rt-shell">
      <div className="rt-app">
        <nav className="rt-sidebar" aria-label="Task navigation">
          <label className="rt-project-label" htmlFor="rt-project">
            Project
          </label>
          <select
            id="rt-project"
            aria-label="Project"
            value={projectId}
            onChange={(event) => chooseProject(event.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {project && project.sources.length > 1 && (
            <select
              aria-label="Checkout"
              value={sourceId ?? snapshot?.source?.id ?? ''}
              onChange={(event) => {
                setSourceId(event.target.value);
                setSelected(null);
              }}
            >
              {project.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.path}
                </option>
              ))}
            </select>
          )}
          <div className="rt-nav-items">
            {(['all', 'attention', 'waiting', 'triage'] as const).map((id) => (
              <button
                key={id}
                data-active={filter === id}
                onClick={() => {
                  setFilter(id);
                  setSelected(null);
                }}
              >
                <Glyph
                  name={
                    id === 'waiting'
                      ? 'clock'
                      : id === 'triage'
                        ? 'inbox'
                        : 'agenda'
                  }
                />
                <span>{labels[id]}</span>
                <small>
                  {tasks.filter((t) => taskMatches(t, id, today)).length}
                </small>
              </button>
            ))}
          </div>
          <div className="rt-sidebar-footer">
            <span className="rt-live-dot" />
            <span>Read-only</span>
            <button
              aria-label="Configure task source"
              onClick={() => setSourceOpen(!sourceOpen)}
            >
              <Glyph name="source" />
            </button>
          </div>
        </nav>
        <div className="rt-workspace" data-detail={Boolean(opened)}>
          <main className="rt-main">
            <header className="rt-toolbar">
              <div>
                <h1>{labels[filter]}</h1>
                <p>
                  {tasks.length} open tasks<span> · </span>
                  {project?.name ?? 'Choose a project'}
                </p>
              </div>
            </header>
            <div className="rt-filters">
              <div className="rt-toolbar-actions">
                <div
                  className="rt-view-switch"
                  role="group"
                  aria-label="Task view"
                >
                  <button
                    aria-pressed={view === 'agenda'}
                    onClick={() => setView('agenda')}
                  >
                    <Glyph name="agenda" />
                    Agenda
                  </button>
                  <button
                    aria-pressed={view === 'board'}
                    onClick={() => setView('board')}
                  >
                    <Glyph name="board" />
                    Board
                  </button>
                </div>
                <button
                  className="rt-icon-button"
                  aria-label="Refresh tasks"
                  disabled={loading}
                  onClick={() => {
                    void refresh();
                  }}
                >
                  <span className={loading ? 'rt-spin' : ''}>
                    <Glyph name="refresh" />
                  </span>
                </button>
              </div>
              <label className="rt-search">
                <Glyph name="search" />
                <input
                  aria-label="Search tasks"
                  placeholder="Find a task…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <select
                aria-label="Client or area"
                value={area}
                onChange={(event) => setArea(event.target.value)}
              >
                <option value="">All areas</option>
                {[...new Set(tasks.map((t) => t.area))].sort().map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
            {sourceOpen && (
              <SourceForm
                key={projectId}
                projectId={projectId}
                taskFile={snapshot?.taskFile ?? 'TODO.md'}
                onSaved={() => {
                  setSelected(null);
                  void refresh();
                }}
                onClose={() => setSourceOpen(false)}
              />
            )}
            {(error || projectsError) && (
              <div className="rt-notice" role="alert">
                {snapshot && !snapshot.error
                  ? 'Showing the last successful read. '
                  : ''}
                {error ?? projectsError}
                <button onClick={() => setSourceOpen(true)}>
                  Choose source
                </button>
              </div>
            )}
            {snapshot?.reviewed && (
              <div className="rt-review">
                <Glyph name="clock" />
                <span>
                  List reviewed {snapshot.reviewed}. Past dates need checking.
                </span>
              </div>
            )}
            <div className="rt-scroll">
              <div className={`rt-groups rt-groups-${view}`}>
                {filteredGroups.map((group) => (
                  <section
                    className="rt-group"
                    key={group.label}
                    aria-label={group.label}
                  >
                    <h2>
                      <span
                        className={`rt-group-dot rt-tone-${group.label === 'Past dates' ? 'past' : group.label === 'Waiting' ? 'waiting' : 'normal'}`}
                      />
                      {group.label}
                      <span className="rt-group-count">
                        {group.tasks.length}
                      </span>
                    </h2>
                    <div className="rt-group-body">
                      {group.tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          selected={selected === task.id}
                          today={today}
                          view={view}
                          onOpen={() => setSelected(task.id)}
                        />
                      ))}
                      {!group.tasks.length && (
                        <p className="rt-empty-column">Nothing here</p>
                      )}
                    </div>
                  </section>
                ))}
                {!filtered.length && (
                  <div className="rt-empty">
                    <Glyph name="inbox" />
                    <h2>
                      {loading
                        ? 'Reading your task file…'
                        : error
                          ? 'Choose a readable task file'
                          : 'No matching tasks'}
                    </h2>
                    <p>
                      {error
                        ? 'Use Source to select the project’s Markdown task list.'
                        : 'Try another client or clear your search.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
            <footer className="rt-footer">
              <button onClick={() => setSourceOpen(!sourceOpen)}>
                <Glyph name="source" />
                {snapshot?.taskFile ?? 'TODO.md'}
              </button>
              <span>
                {filtered.length} shown{fresh && ` · Read ${fresh}`}
              </span>
            </footer>
          </main>
          {opened && snapshot && (
            <Detail
              key={opened.id}
              task={opened}
              snapshot={snapshot}
              onClose={closeDetail}
            />
          )}
        </div>
      </div>
    </div>
  );
}
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: 'tasks',
    title: 'Repo Tasks',
    icon: 'ListTodo',
    path: 'tasks',
    component: TasksPage,
  });
});
