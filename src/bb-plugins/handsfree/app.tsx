import { useEffect, useRef, useState } from 'react';
import {
  definePluginApp, experimental_useSidebarThreads,
  useBbContext, useBbNavigate, useComposer, useComposers, useRealtime, useRpc, useSdk, useSettings, useSidebarSplitLayout,
} from '@get-bb/plugin-sdk/app';
import { requestSchema, type Candidate, type Command, type Kind, type Reply } from './contracts.ts';
import type { rpcContract } from './rpc.ts';
import type { ArchiveTarget } from './archive.ts';
import { publishVoiceHeader, VoiceHeader } from './header.tsx';
import { unavailableDiagnostics, type Diagnostics } from './diagnostics-contract.ts';
import { HexActivity } from './diagnostics-view.tsx';
import { blockingSurface, captureChoice, watchQuestionFocus, type ChoiceCapture } from './choice-target.ts';
import { switcher } from './switcher.ts';
import { createReadout } from './readout.ts';
import { createNavigationHistory } from './navigation.ts';
import './app.css';

interface Choices {
  kind: Kind;
  options: Candidate[];
  context: string;
}

const choiceNumber = (choices: Choices, index: number) => choices.kind === 'favourite'
  ? Number(choices.options[index]?.title) : index + 1;

interface VoiceResult { at: number; message: string; problem: boolean }

function VoiceCard() {
  const routeContext = useBbContext();
  const sidebar = experimental_useSidebarThreads();
  const focusedPane = useSidebarSplitLayout()?.panes.find(pane => pane.isFocused);
  const context = focusedPane ? {
    threadId: focusedPane.threadId,
    projectId: sidebar.threads.find(row => row.id === focusedPane.threadId)?.projectId ?? null,
  } : routeContext;
  const routeComposer = useComposer();
  const composers = useComposers();
  const composer = composers.find(item => context.threadId
    ? item.scope.kind === 'thread' && item.scope.threadId === context.threadId
    : item.scope.kind === 'new-thread') ?? routeComposer;
  const composerAvailable = context.threadId
    ? composer.scope.kind === 'thread' && composer.scope.threadId === context.threadId
    : composer.scope.kind === 'new-thread';
  const navigate = useBbNavigate();
  const openDraft = async (projectId?: string) => {
    if (composerAvailable && composer.scope.kind === 'new-thread') {
      if (projectId) {
        const selection = await composer.setSelection({ projectId });
        if (selection.projectId !== projectId) throw new Error('BB did not switch projects. Check uploads and the project picker, then try again.');
      }
      const current = latestComposer.current;
      if (document.hasFocus() && current.scope.kind === 'new-thread'
        && (!projectId || current.selection?.projectId === projectId)) current.focus();
      return true;
    }
    navigate.toCompose({ ...(projectId ? { projectId } : {}), focusPrompt: true });
    return false;
  };
  const capturedChoice = useRef<{ token: string; capture: ChoiceCapture } | null>(null);
  const sdk = useSdk();
  const agentSwitcher = switcher(composer, sdk, () => {
    if (latestContext.current !== contextKey || !document.hasFocus()) throw new Error('BB focus changed. Say the command again.');
  });
  const rpc = useRpc<typeof rpcContract>();
  const settings = useSettings();
  const [spokenFeedback, setSpokenFeedback] = useState(false);
  useEffect(() => setSpokenFeedback(settings.values?.spokenFeedback === true), [settings.values?.spokenFeedback]);
  const paused = useRef(false);
  const [readout] = useState(createReadout);
  useEffect(() => () => readout.stop(), [readout]);
  const speak = (text: string) => readout.read(text, message => { setMessage(message); setProblem(true); setFeedback(true); });
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [position, setPosition] = useState({ top: 70, left: 18 });
  const card = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Say “voice help” to see commands.');
  const [choices, setChoices] = useState<Choices | null>(null);
  const [archiveConfirmation, setArchiveConfirmation] = useState<{ target: ArchiveTarget; context: string } | null>(null);
  const expanded = monitorOpen || choices !== null || archiveConfirmation !== null;
  const surfaceOpen = useRef(expanded);
  surfaceOpen.current = expanded;
  const close = () => { setChoices(null); setArchiveConfirmation(null); setMonitorOpen(false); if (composerAvailable) composer.focus(); };
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
  const [navigationHistory] = useState(() => createNavigationHistory({ threadId: context.threadId, projectId }));
  useEffect(() => {
    navigationHistory.observe({ threadId: context.threadId, projectId });
  }, [navigationHistory, context.threadId, projectId]);
  const contextKey = `${windowId}|${context.threadId ?? 'draft'}:${projectId ?? ''}:${composer.selection?.providerId ?? ''}:${focusedPane?.paneId ?? ''}:${JSON.stringify(composer.selection?.environment)}`;
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
    diagnosticStart.current = Date.now();
    setFeedback(false);
    setProblem(false);
  }, [context.threadId, projectId]);

  useEffect(() => {
    const last = diagnostics.attempts.filter(entry => !entry.unmatched).at(-1);
    const newer = last && last.at >= diagnosticStart.current && last.at > (history.at(-1)?.at ?? 0);
    const diagnosticFeedback = newer && now - last.at < (last.problem ? 8000 : 4000);
    const state = diagnostics.state;
    const capture = state && now - state.at < 30_000 && (state.state === 'dictating' || state.state === 'transcribing');
    const label = busy ? 'Working…' : capture ? state.state === 'dictating' ? 'Voice · Recording' : 'Voice · Transcribing'
      : diagnosticFeedback ? `Voice · ${last.result}` : feedback ? message : 'Voice';
    publishVoiceHeader({ label, problem: !busy && !capture && (diagnosticFeedback ? last.problem : feedback && problem), expanded });
  }, [busy, feedback, problem, message, expanded, diagnostics, now, history]);

  useEffect(() => {
    if (!feedback || busy) return;
    const timer = window.setTimeout(() => { setFeedback(false); setProblem(false); }, problem ? 8000 : 4000);
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
    const spoken = requested && requested.expires >= Date.now() && (!requested.threadId || requested.threadId === context.threadId);
    if (spoken) {
      void rpc.call('observed', { requestId: requested.requestId, threadId: context.threadId ?? null, title: thread?.displayTitle ?? 'New thread draft' }).catch(() => {});
      // Only a spoken request needs its landing confirmed; clicks and shortcuts show where they went.
      setMessage(destination);
      setFeedback(true);
      setProblem(false);
    }
    setHistory(items => [...items, { at: Date.now(), message: destination, problem: false }].slice(-50));
  }, [context.threadId, thread, sidebar.projects]);

  const list = async (kind: Kind): Promise<Candidate[]> => {
    if (sidebar.status !== 'ready') throw new Error('BB is loading its threads. Try again shortly.');
    if (kind === 'thread') return threads.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 200).map(threadCandidate);
    if (kind === 'project') return sidebar.projects.map(row => ({ id: row.id, label: row.name }));
    if (!composerAvailable) throw new Error('The focused chat composer is unavailable. Open a chat and try again.');
    if (kind === 'account') return (await agentSwitcher.accounts()).profiles.map(profile => ({ id: profile.id, label: profile.label }));
    if (kind === 'favourite') return (await agentSwitcher.favourites()).sort((a, b) => a.slot - b.slot)
      .map(favourite => ({ id: favourite.id, title: String(favourite.slot),
        label: `${favourite.name || favourite.model}${favourite.daybreak ? ' · Daybreak' : ''} (${favourite.providerId === 'claude-code' ? 'Claude Code' : favourite.providerId === 'codex' ? 'Codex' : favourite.providerId}, ${favourite.reasoningLevel ?? 'default'} effort)` }));
    return (await agentSwitcher.models()).map(({ id, label, title }) => ({ id, label, title }));
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
      const ready = await openDraft(id);
      return { ok: true, outcome: ready ? 'completed' : 'requested', message: ready
        ? `Draft ready in ${candidate.label}. Dictate, then press Enter.` : `Opening a new thread in ${candidate.label}.` };
    }
    if (kind === 'account') await agentSwitcher.chooseAccount(id);
    else if (kind === 'favourite') {
      const favourite = (await agentSwitcher.favourites()).find(row => row.id === id);
      if (!favourite) throw new Error('That favourite was removed. Say the command again.');
      if (expectedContext !== latestContext.current || !document.hasFocus()) throw new Error('BB focus changed. Say the command again.');
      await agentSwitcher.controller.apply(favourite);
    } else {
      await agentSwitcher.applyModel(id);
    }
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
        const option = choices.options.find((_, index) => choiceNumber(choices, index) === number);
        if (!option) return { ok: false, outcome: 'error', message: `Voice choice ${number} is unavailable.` };
        return select(choices.kind, option.id, choices.context);
      },
    } : undefined;
    return captureChoice(document, () => latestContext.current, picker,
      !choices && !archiveConfirmation ? card.current ?? undefined : undefined);
  };

  const handle = async (command: Command): Promise<Reply> => {
    if (paused.current && !['listen', 'state', 'heard', 'help', 'notice', 'capture', 'list', 'stop-reading'].includes(command.action)) {
      throw new Error('BB commands are paused. Say “resume commands”.');
    }
    if (!['confirm-archive', 'cancel-archive', 'notice', 'list', 'capture'].includes(command.action)) setArchiveConfirmation(null);
    switch (command.action) {
      case 'listen':
        paused.current = !command.enabled;
        return { ok: true, message: command.enabled ? 'BB commands resumed.' : 'BB commands paused. Say “resume commands” to continue.' };
      case 'feedback':
        if (command.enabled && !readout.available()) throw new Error('Speech output is unavailable on this device.');
        await sdk.plugins.updateSettings({ pluginId: 'handsfree', values: { spokenFeedback: command.enabled } });
        setSpokenFeedback(command.enabled);
        if (command.enabled) speak('Spoken confirmations enabled.');
        return { ok: true, message: command.enabled ? 'Spoken confirmations enabled.' : 'Spoken confirmations disabled.' };
      case 'stop-reading':
        readout.stop();
        return { ok: true, message: 'Reading stopped.' };
      case 'read': {
        if (!context.threadId) throw new Error('Select a thread with a reply to read.');
        const expectedContext = contextKey;
        const result = await sdk.threads.output({ threadId: context.threadId });
        if (latestContext.current !== expectedContext || !document.hasFocus()) throw new Error('BB focus changed. Say the command again.');
        if (!result.output?.trim()) throw new Error('This thread has no reply to read yet.');
        speak(result.output);
        return { ok: true, message: 'Reading the last reply. Say “stop reading” to stop.' };
      }
      case 'state': {
        const expectedContext = contextKey;
        const selection = composer.selection;
        let account = '';
        if (selection?.providerId === 'claude-code') {
          const result = await agentSwitcher.accounts().catch(() => null);
          account = result ? ` Account ${result.profiles.find(profile => profile.id === result.currentId)?.label ?? result.currentId}.` : ' Account selection unavailable.';
        }
        if (latestContext.current !== expectedContext || !document.hasFocus()) throw new Error('BB focus changed. Say the command again.');
        const message = `${thread?.displayTitle ?? 'New thread draft'}. Project ${projectId ? projectName(projectId) : 'not selected'}. ${selection?.providerId ?? 'No provider'}, ${selection?.model ?? 'no model'}, ${selection?.reasoningLevel ?? 'default'} effort.${account}${paused.current ? ' BB commands paused.' : ''}`;
        speak(message);
        return { ok: true, message };
      }
      case 'heard': {
        const expectedContext = contextKey;
        const snapshot = await rpc.call('diagnostics', {});
        if (latestContext.current !== expectedContext || !document.hasFocus()) throw new Error('BB focus changed. Say the command again.');
        const attempt = snapshot.attempts.filter(entry => entry.kind === 'command' && entry.command !== 'bb-heard'
          && !/^what did you hear[?.!]*$/i.test(entry.heard.trim())).at(-1);
        const message = attempt ? `Heard “${attempt.heard}”. ${attempt.result}.` : 'No earlier recognition attempt is available.';
        speak(message);
        return { ok: true, message };
      }
      case 'back': {
        const previous = navigationHistory.back();
        if (!previous) throw new Error('No previous view is available in this window.');
        trackNavigation(previous.threadId ?? undefined);
        setChoices(null);
        if (previous.threadId) navigate.toThread(previous.threadId);
        else navigate.toCompose({ ...(previous.projectId ? { projectId: previous.projectId } : {}), focusPrompt: true });
        return { ok: true, outcome: 'requested', message: 'Returning to the previous view.' };
      }
      case 'focus':
        if (!composerAvailable) throw new Error('The focused chat composer is unavailable. Open a chat and try again.');
        if (blockingSurface(document, undefined, card.current ?? undefined)) throw new Error('Close the popup first. Say “close popup”, then “focus chat”.');
        close();
        return { ok: true, outcome: 'completed', message: 'Chat input focused. Ready for dictation.' };
      case 'send':
        if (!composerAvailable) throw new Error('The focused chat composer is unavailable.');
        if (blockingSurface(document, undefined, card.current ?? undefined) || choices || archiveConfirmation) throw new Error('Close the popup before sending the message.');
        await composer.submit({ experimental_data: null });
        return { ok: true, outcome: 'completed', message: 'Message accepted by BB.' };
      case 'stop': {
        if (!context.threadId) throw new Error('Select an existing thread to stop.');
        const expectedContext = contextKey;
        const target = context.threadId;
        await sdk.threads.stop({ threadId: target });
        const stopped = await sdk.threads.get({ threadId: target });
        if (latestContext.current !== expectedContext) return { ok: true, outcome: 'requested', message: `Stop requested for ${thread?.displayTitle ?? target}.` };
        return { ok: true, outcome: stopped.status === 'idle' || stopped.status === 'error' ? 'completed' : 'requested',
          message: stopped.status === 'idle' || stopped.status === 'error' ? 'Agent stopped.' : 'Stop requested. The agent is still stopping.' };
      }
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
            await openDraft(target.projectId);
          }
        }
        return { ok: true, outcome: result.outcome, message: result.message };
      }
      case 'approve':
        if (!context.threadId) throw new Error('Select a thread with a pending approval.');
        return rpc.call('approve', { threadId: context.threadId, decision: command.decision });
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
      case 'choose':
      case 'submit-answer': {
        let capture: ChoiceCapture;
        if (command.target) {
          const recorded = capturedChoice.current;
          if (!recorded || recorded.token !== command.target) return { ok: false, outcome: 'error', message: 'The recording target expired. Record the command again.' };
          capturedChoice.current = null;
          capture = recorded.capture;
        } else capture = captureTarget();
        return capture.ok ? command.action === 'choose' ? capture.apply(command.number) : capture.submit()
          : { ok: false, outcome: 'error', message: capture.reason };
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
      case 'mark-unread': {
        if (!context.threadId) throw new Error('Select an existing thread to mark unread.');
        await sdk.threads.markUnread({ threadId: context.threadId });
        return { ok: true, outcome: 'completed', message: 'Thread marked unread.' };
      }
      case 'waiting':
      case 'unread': {
        if (sidebar.status !== 'ready') throw new Error('BB is loading its threads. Try again shortly.');
        setChoices(null);
        const next = threads.filter(row => row.id !== context.threadId && (command.action === 'waiting'
          ? row.hasPendingInteraction
          : row.isUnread && (row.runtimeStatus === 'idle' || row.runtimeStatus === 'error')
            && row.queuedWork !== 'waiting' && Object.values(row.activity).every(count => count === 0)))
          .sort((a, b) => a.latestAttentionAt - b.latestAttentionAt || a.id.localeCompare(b.id))[0];
        if (!next) return { ok: true, outcome: 'empty', message: command.action === 'waiting' ? 'No other threads are waiting for your input.' : 'No unread stopped threads.' };
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
      case 'new': {
        trackNavigation();
        setChoices(null);
        const ready = await openDraft(projectId ?? undefined);
        return { ok: true, outcome: ready ? 'completed' : 'requested', message: ready
          ? 'Draft ready. Dictate your task, then press Enter.' : 'Opening a new thread draft.' };
      }
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
      if (spokenFeedback && !['list', 'capture', 'notice', 'feedback', 'read', 'stop-reading', 'state', 'heard'].includes(command.action)) {
        try { speak(reply.message); } catch { reply.message += ' Speech output is unavailable on this device.'; }
      }
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
      if (spokenFeedback && !['list', 'capture', 'notice', 'feedback'].includes(command.action)) {
        try { speak(message); } catch { /* Keep the command failure visible when speech is unavailable. */ }
      }
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
        if (!busy) void run({ action: 'choose', number: choiceNumber(choices, highlight) });
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
      <header className="handsfree-heading"><strong>{choices ? choices.kind === 'favourite' ? 'Favourite models' : 'Choose a match' : archiveConfirmation ? 'Confirm archive' : 'Voice monitor'}</strong><button type="button" aria-label="Close voice controls"
        onClick={close}>×</button></header>
      <p className="handsfree-context">Following {thread?.displayTitle ?? 'New thread'} · {projectId ? projectName(projectId) : 'Choose a project'}</p>
      <p role="status">{message}</p>
      {choices && <p className="handsfree-context">Say “choose” and a number. ↑ ↓ then Enter also works.</p>}
      {archiveConfirmation && <div role="group" aria-label="Confirm archive">
        <button type="button" disabled={busy} onClick={() => void run({ action: 'confirm-archive' })}>Confirm archive</button>
        <button type="button" disabled={busy} onClick={() => void run({ action: 'cancel-archive' })}>Cancel archive</button>
      </div>}
      {choices ? <ol aria-label="Voice choices">{choices.options.map((option, index) => <li key={option.id}>
        <button type="button" disabled={busy} aria-current={index === highlight ? 'true' : undefined}
          onClick={() => void run({ action: 'choose', number: choiceNumber(choices, index) })}>
            <span className="handsfree-choice-number">{choiceNumber(choices, index)}</span>
            <span className="handsfree-choice-label">{choices.kind === 'favourite' ? <>
              <span>{option.label.replace(/ \([^)]*\)$/, '')}</span>
              <small>{option.label.match(/ \(([^)]*)\)$/)?.[1]}</small>
            </> : option.label}</span>
          </button>
      </li>)}</ol> : !archiveConfirmation && <>
      <div role="tablist" aria-label="Voice monitor views" className="handsfree-tabs">
        {(['activity', 'commands'] as const).map(tab => <button type="button" role="tab" id={`voice-${tab}`} key={tab}
          aria-selected={view === tab} aria-controls={`voice-${tab}-panel`} onClick={() => setView(tab)}>
          {tab === 'activity' ? 'Activity' : 'Commands'}</button>)}
      </div>
      <section role="tabpanel" id="voice-commands-panel" aria-labelledby="voice-commands" hidden={view !== 'commands'}><dl>
        <dt>“Voice monitor” / “Voice history”</dt><dd>Show recognition, dictation and command results</dd>
        <dt>“Where am I?” / “What did you hear?”</dt><dd>Read the current selection or the preceding recognition result</dd>
        <dt>“Go back”</dt><dd>Return to the previous thread or draft in this window</dd>
        <dt>“Read the last answer” / “Stop reading”</dt><dd>Read or stop the selected thread's last reply</dd>
        <dt>“Read confirmations” / “Mute confirmations”</dt><dd>Save the spoken feedback preference</dd>
        <dt>“Pause commands” / “Resume commands”</dt><dd>Pause or resume BB voice actions in this window</dd>
        <dt>“Go to the login thread”</dt><dd>Find a thread by description</dd>
        <dt>“Next thread” / “Previous thread”</dt><dd>Follow BB's navigation order</dd>
        <dt>“Mark unread” / “Mark this thread unread”</dt><dd>Mark the focused thread unread, then say “next thread” to move on</dd>
        <dt>“Next unread”</dt><dd>Open the oldest unread stopped thread</dd>
        <dt>“Show Git” / “Show usage”</dt><dd>Open Git status or all agent accounts</dd>
        <dt>“Close popup” / “Close voice monitor”</dt><dd>Close voice controls and dismiss the top popup with Escape</dd>
        <dt>“Who needs me?” / “Next finished”</dt><dd>Show pending questions or unread successful results</dd>
        <dt>“New thread” / “New thread in dotfiles”</dt><dd>Open a draft for dictation</dd>
        <dt>“Focus chat” / “Focus message”</dt><dd>Focus the chat input for dictation</dd>
        {context.threadId && <><dt>“Archive this thread” / “Unarchive last thread”</dt><dd>Archive the selected thread or restore the last voice archive</dd></>}
        <dt>“Show projects” / “Select project kb”</dt><dd>Choose a project for a new draft</dd>
        <dt>“Show models” / “Use Sonnet”</dt><dd>Select a model across available providers. Changing provider prepares a handoff for the next message.</dd>
        <dt>“Show favourites” / “Use favourite two”</dt><dd>Select a saved model and its effort</dd>
        {composer.selection?.providerId === 'claude-code' && <><dt>“Show accounts” / “Use account work”</dt><dd>Select a Claude account after the current turn finishes</dd></>}
        <dt>“Allow once” / “Allow for session” / “Deny approval”</dt><dd>Answer the selected thread's single pending approval</dd>
        <dt>“Choose one” / “Choose two”</dt><dd>Select a numbered voice match or native question answer. Submit answers separately.</dd>
        <dt>“Submit answer” / “Next question”</dt><dd>Use the question's native submit or next button</dd>
        <dt>“Send message” / “Stop this agent”</dt><dd>Send the draft or stop the selected thread's work</dd>
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
