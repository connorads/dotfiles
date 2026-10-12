import { useEffect, useRef, useState } from 'react';
import {
  definePluginApp, experimental_useSidebarThreads, experimental_useSidebarThreadActions,
  useBbContext, useComposer, useComposers, useRealtime, useRpc, useSdk,
} from '@get-bb/plugin-sdk/app';
import { requestSchema, type Candidate, type Command, type Kind, type Reply } from './contracts.ts';
import type { rpcContract } from './rpc.ts';
import type { ArchiveTarget } from './archive.ts';
import './app.css';

interface Choices {
  kind: Kind;
  options: Candidate[];
  context: string;
}

function VoiceCard() {
  const context = useBbContext();
  const routeComposer = useComposer();
  const composers = useComposers();
  const composer = composers.find(item => context.threadId
    ? item.scope.kind === 'thread' && item.scope.threadId === context.threadId
    : item.scope.kind === 'new-thread') ?? routeComposer;
  const sidebar = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [expanded, setExpanded] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Say “voice help” to see commands.');
  const [choices, setChoices] = useState<Choices | null>(null);
  const [archiveConfirmation, setArchiveConfirmation] = useState<{ target: ArchiveTarget; context: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const observedThread = useRef(context.threadId);
  const activeRequest = useRef<string | null>(null);
  const navigationRequest = useRef<{ requestId: string; expires: number; threadId?: string } | null>(null);
  const trackNavigation = (threadId?: string) => {
    if (activeRequest.current) navigationRequest.current = { requestId: activeRequest.current, expires: Date.now() + 3000, ...(threadId ? { threadId } : {}) };
  };
  const [windowId] = useState(() => crypto.randomUUID());
  const [steer, setSteer] = useState<boolean | null>(null);
  const thread = sidebar.threads.find(row => row.id === context.threadId);
  const projectId = composer.scope.kind === 'new-thread'
    ? composer.selection?.projectId ?? composer.scope.projectId ?? context.projectId : context.projectId;
  const contextKey = `${windowId}|${context.threadId ?? 'draft'}:${projectId ?? ''}:${composer.selection?.providerId ?? ''}`;
  const latestContext = useRef(contextKey);
  latestContext.current = contextKey;
  const processing = useRef(false);
  const projectName = (id: string) => sidebar.projects.find(row => row.id === id)?.name ?? id;
  const threads = sidebar.threads.filter(row => !row.isArchived && !row.isHidden);
  const threadCandidate = (row: typeof threads[number]): Candidate => ({
    id: row.id, title: row.displayTitle, project: projectName(row.projectId),
    label: `${row.displayTitle} (${projectName(row.projectId)}, ${row.providerId})`,
  });

  useEffect(() => {
    let active = true;
    void sdk.system.config().then(config => { if (active) setSteer(config.generalSettings.steerActiveThreadOnEnter); }).catch(() => {});
    return () => { active = false; };
  }, [sdk]);

  useEffect(() => { setChoices(null); setArchiveConfirmation(null); setHighlight(0); }, [contextKey]);
  useEffect(() => { if (!expanded) setArchiveConfirmation(null); }, [expanded]);
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
    setHistory(items => [...items, destination].slice(-10));
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
    setChoices(null);
    if (kind === 'thread') {
      trackNavigation(id);
      actions.open(id);
      return { ok: true, outcome: 'requested', message: `Opening ${candidate.label}` };
    }
    if (kind === 'project') {
      trackNavigation();
      actions.openNewThread({ projectId: id, focusPrompt: true });
      return { ok: true, message: `Draft ready in ${candidate.label}. Dictate, then press Enter.` };
    }
    const selection = await composer.setSelection({ model: id });
    if (selection.model !== id) throw new Error('BB did not select that model. Check the composer picker.');
    composer.focus();
    return { ok: true, message: `${candidate.label} selected for the next message.` };
  };

  const handle = async (command: Command): Promise<Reply> => {
    if (command.action !== 'confirm-archive' && command.action !== 'cancel-archive') setArchiveConfirmation(null);
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
          setExpanded(true);
          setArchiveConfirmation({ target: result.target, context: expectedContext });
        } else {
          setArchiveConfirmation(null);
          if (result.outcome === 'archived' && latestContext.current === expectedContext) {
            trackNavigation();
            actions.openNewThread({ projectId: target.projectId, focusPrompt: true });
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
          actions.open(result.target.threadId);
        }
        return { ok: result.outcome === 'restored', outcome: result.outcome, message: result.message };
      }
      case 'list': return { ok: true, message: 'Choices loaded.', candidates: await list(command.kind), context: contextKey };
      case 'select': return select(command.kind, command.id, command.context);
      case 'choices': {
        if (command.context !== contextKey) throw new Error('The selected thread changed. Say the command again.');
        const candidates = await list(command.kind);
        if (command.context !== latestContext.current) throw new Error('The selected thread changed. Say the command again.');
        const options = command.options.filter(option => candidates.some(row => row.id === option.id));
        if (!options.length) throw new Error('Those choices are no longer available.');
        setChoices({ kind: command.kind, options, context: command.context });
        setHighlight(0);
        setExpanded(true);
        return { ok: true, outcome: 'choices', message: command.message };
      }
      case 'choose': {
        const option = choices?.options[command.number - 1];
        if (!choices || !option) throw new Error('There is no such numbered voice choice. Say “voice help”.');
        return select(choices.kind, option.id, choices.context);
      }
      case 'attention':
      case 'finished': {
        setChoices(null);
        setExpanded(true);
        const options = threads.filter(row => command.action === 'attention'
          ? row.hasPendingInteraction : row.indicator === 'unread-success').map(threadCandidate).slice(0, 9);
        if (!options.length) return { ok: true, outcome: 'empty', message: command.action === 'attention' ? 'No agents are waiting for your answer.' : 'No unread finished threads.' };
        setChoices({ kind: 'thread', options, context: contextKey });
        setHighlight(0);
        setExpanded(true);
        return { ok: true, outcome: 'choices', message: command.action === 'attention' ? 'These agents need you. Say “choose one”, or press Enter.' : 'Finished threads. Say “choose one”, or press Enter.' };
      }
      case 'new':
        trackNavigation();
        setChoices(null);
        actions.openNewThread({ ...(projectId ? { projectId } : {}), focusPrompt: true });
        return { ok: true, message: 'Draft ready. Dictate your task, then press Enter.' };
      case 'help':
        setChoices(null);
        setExpanded(true);
        return { ok: true, message: 'Say commands with the dictation pedal released.' };
      case 'notice':
        if (command.problem) setExpanded(true);
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
        setHistory(items => [...items, reply.message].slice(-10));
      }
      return reply;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setMessage(message);
      setHistory(items => [...items, message].slice(-10));
      setExpanded(true);
      return { ok: false, outcome: 'error', message };
    } finally { setBusy(false); }
  };

  useRealtime('command', async payload => {
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success || !document.hasFocus() || processing.current) return;
    if ('context' in parsed.data.command && !parsed.data.command.context.startsWith(`${windowId}|`)) return;
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
      if (event.key === 'Escape' && expanded) {
        event.preventDefault(); event.stopImmediatePropagation();
        setChoices(null); setExpanded(false); composer.focus();
        setArchiveConfirmation(null);
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

  return <aside className="handsfree" aria-label="BB voice controls" data-context={contextKey}>
    <button type="button" className="handsfree-toggle" aria-expanded={expanded} onClick={() => {
      if (expanded) { setChoices(null); setArchiveConfirmation(null); composer.focus(); }
      setExpanded(value => !value);
    }}>
      Voice{busy ? ' · Working' : ''}
    </button>
    {!expanded && <p className="handsfree-status" role="status" title={message}>{message}</p>}
    {expanded && <div ref={card} className="handsfree-card" tabIndex={-1}>
      <strong>{thread?.displayTitle ?? 'New thread'}</strong>
      <p>{projectId ? projectName(projectId) : 'Choose a project'} · {composer.selection?.model ?? composer.selection?.providerId ?? 'Choose an agent'}</p>
      <p role="status">{message}</p>
      {archiveConfirmation && <div role="group" aria-label="Confirm archive">
        <button type="button" disabled={busy} onClick={() => void run({ action: 'confirm-archive' })}>Confirm archive</button>
        <button type="button" disabled={busy} onClick={() => void run({ action: 'cancel-archive' })}>Cancel archive</button>
      </div>}
      {choices ? <ol>{choices.options.map((option, index) => <li key={option.id}>
        <button type="button" disabled={busy} aria-current={index === highlight ? 'true' : undefined}
          onClick={() => void run({ action: 'choose', number: index + 1 })}>{index + 1}. {option.label}</button>
      </li>)}</ol> : !archiveConfirmation && <dl>
        <dt>“Go to the login thread”</dt><dd>Find a thread by description</dd>
        <dt>“Next thread” / “Previous thread”</dt><dd>Follow BB's navigation order</dd>
        <dt>“Who needs me?”</dt><dd>Show agents waiting for your answer</dd>
        <dt>“New thread” / “New thread in dotfiles”</dt><dd>Open a draft for dictation</dd>
        <dt>“Archive this thread” / “Unarchive last thread”</dt><dd>Archive the selected thread or restore the last voice archive</dd>
        <dt>“Show projects” / “Select project kb”</dt><dd>Choose a project for a new draft</dd>
        <dt>“Use Sonnet” / “Choose two”</dt><dd>Select a model or numbered match</dd>
      </dl>}
      {history.length > 0 && <details>
        <summary>Recent voice results</summary>
        <ol aria-label="Recent voice results">{history.map((entry, index) => <li key={index}>{entry}</li>)}</ol>
      </details>}
      <p className="handsfree-pedals">Right Alt: dictate · Enter: {choices ? 'choose while this card has focus' : composer.isRunning ? steer === null ? 'BB send setting' : steer ? 'steer running agent' : 'queue message' : 'send'} · Escape: close voice help</p>
    </div>}
  </aside>;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'voice', component: VoiceCard });
});
