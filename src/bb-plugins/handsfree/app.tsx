import { useEffect, useRef, useState } from 'react';
import {
  definePluginApp, experimental_useSidebarThreads,
  useBbContext, useBbNavigate, useComposer, useComposers, useRealtime, useRpc, useSdk,
} from '@get-bb/plugin-sdk/app';
import { requestSchema, type Candidate, type Command, type Kind, type Reply } from './contracts.ts';
import type { rpcContract } from './rpc.ts';
import type { ArchiveTarget } from './archive.ts';
import { publishVoiceHeader, VoiceHeader } from './header.tsx';
import { unavailableDiagnostics, type Diagnostics } from './diagnostics-contract.ts';
import { HexActivity } from './diagnostics-view.tsx';
import { blockingSurface, captureChoice, watchQuestionFocus, type ChoiceCapture } from './choice-target.ts';
import './app.css';

interface Choices {
  kind: Kind;
  options: Candidate[];
  context: string;
}

interface VoiceResult { at: number; message: string; problem: boolean }

function VoiceCard() {
  const context = useBbContext();
  const routeComposer = useComposer();
  const composers = useComposers();
  const composer = composers.find(item => context.threadId
    ? item.scope.kind === 'thread' && item.scope.threadId === context.threadId
    : item.scope.kind === 'new-thread') ?? routeComposer;
  const sidebar = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const draftFocus = useRef<string | null>(null);
  const openDraft = (projectId?: string) => {
    if (projectId) {
      if (composer.scope.kind === 'new-thread' && (composer.selection?.projectId ?? composer.scope.projectId ?? context.projectId) === projectId) composer.focus();
      else { draftFocus.current = projectId; navigate.toProject(projectId); }
    }
    else navigate.toCompose({ focusPrompt: true });
  };
  const capturedChoice = useRef<{ token: string; capture: ChoiceCapture } | null>(null);
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [position, setPosition] = useState({ top: 70, left: 18 });
  const card = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Say “voice help” to see commands.');
  const [choices, setChoices] = useState<Choices | null>(null);
  const [archiveConfirmation, setArchiveConfirmation] = useState<{ target: ArchiveTarget; context: string } | null>(null);
  const expanded = monitorOpen || choices !== null || archiveConfirmation !== null;
  const surfaceOpen = useRef(expanded);
  surfaceOpen.current = expanded;
  const close = () => { setChoices(null); setArchiveConfirmation(null); setMonitorOpen(false); composer.focus(); };
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<VoiceResult[]>([]);
  const [view, setView] = useState<'activity' | 'commands'>('activity');
  const [problem, setProblem] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>(unavailableDiagnostics);
  const [now, setNow] = useState(Date.now);
  const diagnosticStart = useRef(Date.now());
  const observedThread = useRef(context.threadId);
  const activeRequest = useRef<string | null>(null);
  const navigationRequest = useRef<{ requestId: string; expires: number; threadId?: string } | null>(null);
  const trackNavigation = (threadId?: string) => {
    if (activeRequest.current) navigationRequest.current = { requestId: activeRequest.current, expires: Date.now() + 3000, ...(threadId ? { threadId } : {}) };
  };
  const [windowId] = useState(() => crypto.randomUUID());
  const thread = sidebar.threads.find(row => row.id === context.threadId);
  const projectId = composer.scope.kind === 'new-thread'
    ? composer.selection?.projectId ?? composer.scope.projectId ?? context.projectId : context.projectId;
  const contextKey = `${windowId}|${context.threadId ?? 'draft'}:${projectId ?? ''}:${composer.selection?.providerId ?? ''}`;
  const latestContext = useRef(contextKey);
  latestContext.current = contextKey;
  const latestComposer = useRef(composer);
  latestComposer.current = composer;
  useEffect(() => watchQuestionFocus(document, () => latestContext.current, () => latestComposer.current.focus()), []);
  const processing = useRef(false);
  const projectName = (id: string) => sidebar.projects.find(row => row.id === id)?.name ?? id;
  const threads = sidebar.threads.filter(row => !row.isArchived && !row.isHidden);
  const threadCandidate = (row: typeof threads[number]): Candidate => ({
    id: row.id, title: row.displayTitle, project: projectName(row.projectId),
    label: `${row.displayTitle} (${projectName(row.projectId)}, ${row.providerId})`,
  });

  useEffect(() => {
    const open = () => { setView('activity'); setChoices(null); setArchiveConfirmation(null); setMonitorOpen(!surfaceOpen.current); };
    window.addEventListener('handsfree:open', open);
    return () => {
      window.removeEventListener('handsfree:open', open);
      publishVoiceHeader({ label: 'Voice', problem: false, expanded: false });
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      const snapshot = await rpc.call('diagnostics', {}).catch(() => unavailableDiagnostics);
      if (!active) return;
      setDiagnostics(snapshot);
      setNow(Date.now());
      timer = window.setTimeout(() => { void poll(); }, 750);
    };
    void poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [rpc]);

  useEffect(() => {
    const last = diagnostics.attempts.filter(entry => !entry.unmatched).at(-1);
    const newer = last && last.at >= diagnosticStart.current && last.at > (history.at(-1)?.at ?? 0);
    const state = diagnostics.state;
    const capture = state && now - state.at < 30_000 && (state.state === 'dictating' || state.state === 'transcribing');
    const label = busy ? 'Working…' : capture ? state.state === 'dictating' ? 'Voice · Recording' : 'Voice · Transcribing'
      : newer && (last.problem || now - last.at < 4000) ? `Voice · ${last.result}` : feedback || problem ? message : 'Voice';
    publishVoiceHeader({ label, problem: !busy && !capture && (newer ? last.problem : problem), expanded });
  }, [busy, feedback, problem, message, expanded, diagnostics, now, history]);

  useEffect(() => {
    if (!feedback || problem || busy) return;
    const timer = window.setTimeout(() => setFeedback(false), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback, problem, busy, message]);

  useEffect(() => {
    if (!expanded) return;
    const place = () => {
      const control = Array.from(document.querySelectorAll<HTMLElement>('[data-handsfree-header]')).find(element => element.getClientRects().length);
      const anchor = control?.getBoundingClientRect();
      const width = Math.min(440, window.innerWidth - 36);
      setPosition({ top: Math.max(18, Math.min(anchor ? anchor.bottom + 8 : 70, window.innerHeight - 320)),
        left: Math.max(18, Math.min(anchor ? anchor.right - width : window.innerWidth - width - 18, window.innerWidth - width - 18)) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [expanded]);

  useEffect(() => {
    if (draftFocus.current && composer.scope.kind === 'new-thread' && projectId === draftFocus.current) {
      draftFocus.current = null;
      if (document.hasFocus()) composer.focus();
    }
  }, [composer, composer.scope.kind, projectId]);

  useEffect(() => { setChoices(null); setArchiveConfirmation(null); setHighlight(0); }, [contextKey]);
  useEffect(() => {
    if (choices || archiveConfirmation) card.current?.focus();
  }, [choices, archiveConfirmation]);
  useEffect(() => {
    if (observedThread.current === context.threadId) return;
    observedThread.current = context.threadId;
    const destination = thread ? `Viewing ${thread.displayTitle} (${projectName(thread.projectId)}).` : 'Viewing a new thread draft.';
    const requested = navigationRequest.current;
    navigationRequest.current = null;
    if (requested && requested.expires >= Date.now() && (!requested.threadId || requested.threadId === context.threadId)) {
      void rpc.call('observed', { requestId: requested.requestId, threadId: context.threadId ?? null, title: thread?.displayTitle ?? 'New thread draft' }).catch(() => {});
    }
    setMessage(destination);
    setFeedback(true);
    setProblem(false);
    setHistory(items => [...items, { at: Date.now(), message: destination, problem: false }].slice(-50));
  }, [context.threadId, thread, sidebar.projects]);

  const list = async (kind: Kind): Promise<Candidate[]> => {
    if (sidebar.status !== 'ready') throw new Error('BB is loading its threads. Try again shortly.');
    if (kind === 'thread') return threads.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200).map(threadCandidate);
    if (kind === 'project') return sidebar.projects.map(row => ({ id: row.id, label: row.name }));
    const providerId = composer.selection?.providerId;
    if (!providerId) throw new Error('Select an agent in the BB composer first.');
    const environment = composer.selection?.environment;
    const hostId = thread?.host?.id ?? (environment && 'hostId' in environment ? environment.hostId : undefined);
    const models = await sdk.providers.models(hostId ? { providerId, hostId } : { providerId });
    if (models.modelLoadError) throw new Error(models.modelLoadError.detail ?? 'BB could not load the model list.');
    return models.models.filter(model => !model.routeProviderId || model.routeProviderId === providerId)
      .map(model => ({ id: model.model, label: model.displayName }));
  };

  const select = async (kind: Kind, id: string, expectedContext: string): Promise<Reply> => {
    if (expectedContext !== latestContext.current) throw new Error('The selected thread changed. Say the command again.');
    const candidates = await list(kind);
    if (expectedContext !== latestContext.current || !document.hasFocus()) throw new Error('BB focus changed. Say the command again.');
    const candidate = candidates.find(row => row.id === id);
    if (!candidate) throw new Error('That choice is no longer available. Say the command again.');
    if (kind === 'thread') {
      setChoices(null);
      if (card.current?.contains(document.activeElement)) composer.focus();
      trackNavigation(id);
      navigate.toThread(id);
      return { ok: true, outcome: 'requested', message: `Opening ${candidate.label}` };
    }
    if (kind === 'project') {
      setChoices(null);
      trackNavigation();
      openDraft(id);
      return { ok: true, message: `Draft ready in ${candidate.label}. Dictate, then press Enter.` };
    }
    const selection = await composer.setSelection({ model: id });
    if (selection.model !== id) throw new Error('BB did not select that model. Check the composer picker.');
    setChoices(null);
    composer.focus();
    return { ok: true, message: `${candidate.label} selected for the next message.` };
  };

  const latestChoices = useRef(choices);
  latestChoices.current = choices;
  const captureTarget = () => {
    const picker = choices && card.current ? {
      root: card.current,
      key: choices.context + JSON.stringify(choices.options),
      currentKey: () => latestChoices.current === choices
        ? choices.context + JSON.stringify(choices.options) : null,
      choose: async (number: number): Promise<Reply> => {
        const option = choices.options[number - 1];
        if (!option) return { ok: false, outcome: 'error', message: `Voice choice ${number} is unavailable.` };
        return select(choices.kind, option.id, choices.context);
      },
    } : undefined;
    return captureChoice(document, () => latestContext.current, picker,
      !choices && !archiveConfirmation ? card.current ?? undefined : undefined);
  };

  const handle = async (command: Command): Promise<Reply> => {
    if (!['confirm-archive', 'cancel-archive', 'notice', 'list', 'capture'].includes(command.action)) setArchiveConfirmation(null);
    switch (command.action) {
      case 'archive':
      case 'confirm-archive': {
        if (!context.threadId) throw new Error('Select an existing thread to archive.');
        const expectedContext = contextKey;
        const pending = command.action === 'confirm-archive' ? archiveConfirmation : null;
        if (command.action === 'confirm-archive' && (!pending || pending.context !== expectedContext)) {
          throw new Error('There is no archive to confirm. Say “archive this thread”.');
        }
        const target = pending?.target ?? await rpc.call('archiveTarget', { threadId: context.threadId });
        if (latestContext.current !== expectedContext || !document.hasFocus()) throw new Error('BB focus changed. Say the archive command again.');
        const result = await rpc.call('archive', { target, confirmed: command.action === 'confirm-archive' });
        setChoices(null);
        if (result.outcome === 'confirmation' && result.target) {
          setArchiveConfirmation({ target: result.target, context: expectedContext });
        } else {
          setArchiveConfirmation(null);
          if (result.outcome === 'archived' && latestContext.current === expectedContext) {
            trackNavigation();
            openDraft(target.projectId);
          }
        }
        return { ok: true, outcome: result.outcome, message: result.message };
      }
      case 'cancel-archive':
        setArchiveConfirmation(null);
        return { ok: true, outcome: 'cancelled', message: 'Archive cancelled.' };
      case 'restore': {
        const expectedContext = contextKey;
        const result = await rpc.call('restore', {});
        if (result.outcome === 'restored' && result.target && latestContext.current === expectedContext && document.hasFocus()) {
          trackNavigation(result.target.threadId);
          navigate.toThread(result.target.threadId);
        }
        return { ok: result.outcome === 'restored', outcome: result.outcome, message: result.message };
      }
      case 'capture': {
        const token = crypto.randomUUID();
        capturedChoice.current = { token, capture: captureTarget() };
        return { ok: true, message: 'Recording target captured.', context: contextKey, choiceTarget: token };
      }
      case 'list': return { ok: true, message: 'Choices loaded.', candidates: await list(command.kind), context: contextKey };
      case 'select': return select(command.kind, command.id, command.context);
      case 'choices': {
        if (command.context !== contextKey) throw new Error('The selected thread changed. Say the command again.');
        const candidates = await list(command.kind);
        if (command.context !== latestContext.current) throw new Error('The selected thread changed. Say the command again.');
        const options = command.options.filter(option => candidates.some(row => row.id === option.id));
        if (!options.length) throw new Error('Those choices are no longer available.');
        if (options.length === 1) return select(command.kind, options[0].id, command.context);
        setChoices({ kind: command.kind, options, context: command.context });
        setHighlight(0);
        return { ok: true, outcome: 'choices', message: command.message };
      }
      case 'choose': {
        let capture: ChoiceCapture;
        if (command.target) {
          const recorded = capturedChoice.current;
          if (!recorded || recorded.token !== command.target) return { ok: false, outcome: 'error', message: 'The recording target expired. Record the command again.' };
          capturedChoice.current = null;
          capture = recorded.capture;
        } else capture = captureTarget();
        return capture.ok ? capture.apply(command.number) : { ok: false, outcome: 'error', message: capture.reason };
      }
      case 'show': {
        setChoices(null);
        setMonitorOpen(false);
        const control = command.view === 'git'
          ? Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-git-glance]'))
            .find(button => button.dataset.gitGlance === context.threadId)
          : document.querySelector<HTMLButtonElement>('button[aria-label^="Open all agent usage."]');
        if (!control || control.disabled) throw new Error(`${command.view === 'git' ? 'Git' : 'Agent usage'} is unavailable in this view.`);
        if (command.view !== 'git' || control.getAttribute('aria-expanded') !== 'true') control.click();
        return { ok: true, message: command.view === 'git' ? 'Showing Git status.' : 'Showing agent usage.' };
      }
      case 'dismiss':
        if (card.current?.contains(document.activeElement)) composer.focus();
        setChoices(null);
        setMonitorOpen(false);
        return { ok: true, outcome: 'requested', message: 'Escape requested to close the top popup.', press: { key: 'escape', modifiers: [] } };
      case 'unread': {
        if (sidebar.status !== 'ready') throw new Error('BB is loading its threads. Try again shortly.');
        setChoices(null);
        const next = threads.filter(row => row.id !== context.threadId && row.isUnread
          && (row.runtimeStatus === 'idle' || row.runtimeStatus === 'error')
          && row.queuedWork !== 'waiting' && Object.values(row.activity).every(count => count === 0))
          .sort((a, b) => a.latestAttentionAt - b.latestAttentionAt || a.id.localeCompare(b.id))[0];
        if (!next) return { ok: true, outcome: 'empty', message: 'No unread stopped threads.' };
        trackNavigation(next.id);
        navigate.toThread(next.id);
        return { ok: true, outcome: 'requested', message: `Opening ${threadCandidate(next).label}` };
      }
      case 'attention':
      case 'finished': {
        setChoices(null);
        const options = threads.filter(row => command.action === 'attention'
          ? row.hasPendingInteraction : row.indicator === 'unread-success').map(threadCandidate).slice(0, 9);
        if (!options.length) return { ok: true, outcome: 'empty', message: command.action === 'attention' ? 'No agents are waiting for your answer.' : 'No unread finished threads.' };
        setChoices({ kind: 'thread', options, context: contextKey });
        setHighlight(0);
        return { ok: true, outcome: 'choices', message: command.action === 'attention' ? 'These agents need you. Say “choose one”, or press Enter.' : 'Finished threads. Say “choose one”, or press Enter.' };
      }
      case 'new':
        trackNavigation();
        setChoices(null);
        openDraft(projectId ?? undefined);
        return { ok: true, message: 'Draft ready. Dictate your task, then press Enter.' };
      case 'monitor':
        setChoices(null); setView('activity'); setMonitorOpen(true);
        return { ok: true, message: 'Showing voice activity.' };
      case 'help':
        setChoices(null);
        setView('commands');
        setMonitorOpen(true);
        return { ok: true, message: 'Say commands with the dictation pedal released.' };
      case 'notice':
        return { ok: true, message: command.message };
      case 'next':
      case 'previous': {
        setChoices(null);
        const config = await sdk.system.config();
        const binding = config.keybindings.find(row => row.command === `thread.${command.action}`
          && row.desktopOnly && row.when.all.includes('macPlatform'));
        if (!binding?.shortcut) throw new Error('That BB navigation shortcut is disabled. Check Settings > Keyboard.');
        const key = binding.shortcut;
        const modifiers: NonNullable<Reply['press']>['modifiers'] = [];
        if (key.mod || key.meta) modifiers.push('command');
        if (key.control) modifiers.push('control');
        if (key.alt) modifiers.push('option');
        if (key.shift) modifiers.push('shift');
        trackNavigation();
        return { ok: true, outcome: 'requested', message: `${command.action === 'next' ? 'Next' : 'Previous'} thread requested. Check the destination above.`, press: { key: key.key.toLowerCase(), modifiers } };
      }
    }
  };

  const run = async (command: Command): Promise<Reply> => {
    setBusy(true);
    try {
      const reply = await handle(command);
      if (command.action !== 'list') {
        setMessage(reply.message);
        setFeedback(true);
        setProblem(!reply.ok || reply.outcome === 'no-match' || command.action === 'notice' && !!command.problem);
        setHistory(items => [...items, { at: Date.now(), message: reply.message,
          problem: !reply.ok || reply.outcome === 'no-match' || command.action === 'notice' && !!command.problem }].slice(-50));
      }
      return reply;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setMessage(message);
      setProblem(true);
      setFeedback(true);
      setHistory(items => [...items, { at: Date.now(), message, problem: true }].slice(-50));
      return { ok: false, outcome: 'error', message };
    } finally { setBusy(false); }
  };

  useRealtime('command', async payload => {
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success || !document.hasFocus()) return;
    if ('context' in parsed.data.command && !parsed.data.command.context.startsWith(`${windowId}|`)) return;
    if (processing.current) {
      const { requestId } = parsed.data;
      const { claimed } = await rpc.call('claim', { requestId });
      if (claimed) await rpc.call('complete', { requestId, reply: { ok: false, message: 'Busy with another voice command. Try again.' } });
      return;
    }
    processing.current = true;
    try {
      const { requestId, command } = parsed.data;
      const { claimed } = await rpc.call('claim', { requestId });
      if (!claimed) return;
      activeRequest.current = requestId;
      const reply = document.hasFocus() ? await run(command) : { ok: false, message: 'BB lost focus. Try again.' };
      await rpc.call('complete', { requestId, reply });
    } finally { processing.current = false; activeRequest.current = null; }
  });

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key === 'Escape' && expanded && !blockingSurface(document, undefined, card.current ?? undefined)) {
        event.preventDefault(); event.stopImmediatePropagation();
        close();
      } else if (expanded && choices && card.current?.contains(document.activeElement) && event.key === 'Enter') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!busy) void run({ action: 'choose', number: highlight + 1 });
      } else if (expanded && choices && card.current?.contains(document.activeElement) && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); event.stopImmediatePropagation();
        setHighlight(index => (index + (event.key === 'ArrowDown' ? 1 : choices.options.length - 1)) % choices.options.length);
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => document.removeEventListener('keydown', keydown, true);
  }, [choices, expanded, busy, highlight, composer, contextKey]);

  return expanded ? <aside className="handsfree" aria-label="BB voice controls" data-context={contextKey}
    style={{ top: position.top, left: position.left, maxHeight: `calc(100vh - ${position.top + 18}px)` }}>
    <div ref={card} className="handsfree-card" role="dialog" aria-label={choices ? 'Voice choices' : archiveConfirmation ? 'Confirm archive' : 'Voice monitor'} tabIndex={-1} onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))) return;
      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault(); event.stopPropagation();
        close();
      }
    }}>
      <header className="handsfree-heading"><strong>{choices ? 'Choose a match' : archiveConfirmation ? 'Confirm archive' : 'Voice monitor'}</strong><button type="button" aria-label="Close voice controls"
        onClick={close}>×</button></header>
      <p className="handsfree-context">Following {thread?.displayTitle ?? 'New thread'} · {projectId ? projectName(projectId) : 'Choose a project'}</p>
      <p role="status">{message}</p>
      {archiveConfirmation && <div role="group" aria-label="Confirm archive">
        <button type="button" disabled={busy} onClick={() => void run({ action: 'confirm-archive' })}>Confirm archive</button>
        <button type="button" disabled={busy} onClick={() => void run({ action: 'cancel-archive' })}>Cancel archive</button>
      </div>}
      {choices ? <ol aria-label="Voice choices">{choices.options.map((option, index) => <li key={option.id}>
        <button type="button" disabled={busy} aria-current={index === highlight ? 'true' : undefined}
          onClick={() => void run({ action: 'choose', number: index + 1 })}>{index + 1}. {option.label}</button>
      </li>)}</ol> : !archiveConfirmation && <>
      <div role="tablist" aria-label="Voice monitor views" className="handsfree-tabs">
        {(['activity', 'commands'] as const).map(tab => <button type="button" role="tab" id={`voice-${tab}`} key={tab}
          aria-selected={view === tab} aria-controls={`voice-${tab}-panel`} onClick={() => setView(tab)}>
          {tab === 'activity' ? 'Activity' : 'Commands'}</button>)}
      </div>
      <section role="tabpanel" id="voice-commands-panel" aria-labelledby="voice-commands" hidden={view !== 'commands'}><dl>
        <dt>“Voice monitor” / “Voice history”</dt><dd>Show recognition, dictation and command results</dd>
        <dt>“Go to the login thread”</dt><dd>Find a thread by description</dd>
        <dt>“Next thread” / “Previous thread”</dt><dd>Follow BB's navigation order</dd>
        <dt>“Next unread”</dt><dd>Open the oldest unread stopped thread</dd>
        <dt>“Show Git” / “Show usage”</dt><dd>Open Git status or all agent accounts</dd>
        <dt>“Close popup” / “Close voice monitor”</dt><dd>Close voice controls and dismiss the top popup with Escape</dd>
        <dt>“Who needs me?” / “Next finished”</dt><dd>Show pending questions or unread successful results</dd>
        <dt>“New thread” / “New thread in dotfiles”</dt><dd>Open a draft for dictation</dd>
        <dt>“Archive this thread” / “Unarchive last thread”</dt><dd>Archive the selected thread or restore the last voice archive</dd>
        <dt>“Show projects” / “Select project kb”</dt><dd>Choose a project for a new draft</dd>
        <dt>“Use Sonnet”</dt><dd>Select a model</dd>
        <dt>“Choose one” / “Choose two”</dt><dd>Select a numbered voice match or native question answer. Submit answers separately.</dd>
      </dl></section>
      <section role="tabpanel" id="voice-activity-panel" aria-labelledby="voice-activity" hidden={view !== 'activity'}>
        <HexActivity snapshot={diagnostics} now={now}>
        <h3 className="handsfree-results-heading">BB results</h3>
        {history.length ? <ol aria-label="Recent voice results" className="handsfree-history">
          {history.slice().reverse().map((entry, index) => <li key={index} data-problem={entry.problem}>
            <div><time>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              {entry.problem && <span>Failed</span>}</div><p>{entry.message}</p>
          </li>)}
        </ol> : <p>No voice results in this window yet.</p>}
        </HexActivity>
      </section></>}
    </div>
  </aside> : null;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'voice', component: VoiceCard });
  app.slots.experimental_threadHeaderAction({ id: 'voice', title: 'Voice monitor', component: VoiceHeader });
  app.composer.customize({ id: 'voice', scopes: ['new-thread'], actions: [{ id: 'voice', component: VoiceHeader }] });
});
