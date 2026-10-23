import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSdk } from '@get-bb/plugin-sdk/app';
import { ChipPopover } from '@bb-plugins/chip';
import { MAX_COUNT, forkCommand, type ForkPlan, type ModelChoice, type Placement, type ReasoningLevel } from './fork.ts';

export interface MenuSource { threadId: string; sourceSeqEnd?: number }

interface Props {
  source: MenuSource;
  returnFocus: HTMLElement | null;
  onRun: (plan: ForkPlan) => void;
  onCopy: (text: string, what: string) => void;
  onClose: () => void;
}

interface Model { model: string; label: string; efforts: ReasoningLevel[]; defaultEffort: ReasoningLevel | null }

const levels = new Set<string>(['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']);
const isLevel = (value: string): value is ReasoningLevel => levels.has(value);

/** Keys that pick a placement on the main step. Enter is handled apart so a focused row keeps it. */
const width = 380;
// Centred near the top. The focus to return to is often the composer, and the
// popover would otherwise sit under it at the bottom of the window.
function centred() {
  const w = Math.min(width, window.innerWidth - 24);
  return { width: w, top: Math.round(window.innerHeight * 0.15), left: (window.innerWidth - w) / 2, origin: 'top center' };
}

const placementKeys: Record<string, Placement> = {
  s: 'sidebar', '|': 'right', ArrowRight: 'right', ArrowLeft: 'left', '-': 'down', ArrowDown: 'down', ArrowUp: 'top',
};

async function loadModels(sdk: ReturnType<typeof useSdk>, threadId: string): Promise<Model[]> {
  const thread = await sdk.threads.get({ threadId });
  const options = await sdk.providers.models(thread.environmentId
    ? { providerId: thread.providerId, environmentId: thread.environmentId }
    : { providerId: thread.providerId });
  if (options.modelLoadError) throw new Error(options.modelLoadError.detail ?? options.modelLoadError.code);
  return options.models.map(entry => ({
    model: entry.model,
    label: entry.displayName,
    efforts: entry.supportedReasoningEfforts.map(effort => effort.reasoningEffort).filter(isLevel),
    defaultEffort: isLevel(entry.defaultReasoningEffort) ? entry.defaultReasoningEffort : null,
  }));
}

type Step = { kind: 'main' } | { kind: 'model' } | { kind: 'effort'; model: Model } | { kind: 'prompt' };

function Row({ keys, label, detail, onPick }: { keys: string; label: string; detail?: string; onPick: () => void }) {
  return <button type="button" className="fork-menu-row" onClick={onPick}>
    <kbd>{keys}</kbd><span>{label}</span>{detail ? <span className="fork-menu-detail">{detail}</span> : null}
  </button>;
}

export function ForkMenu({ source, returnFocus, onRun, onCopy, onClose }: Props) {
  const sdk = useSdk();
  const [step, setStep] = useState<Step>({ kind: 'main' });
  const [count, setCount] = useState(1);
  const [worktree, setWorktree] = useState(false);
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState<Model[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const draft = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (step.kind !== 'model' || models) return;
    let live = true;
    loadModels(sdk, source.threadId).then(list => { if (live) setModels(list); }, cause => { if (live) setModelError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { live = false; };
  }, [step.kind, models, sdk, source.threadId]);

  // A step swaps its rows out; focus the new first row so keys still reach the dialog.
  useEffect(() => {
    if (step.kind === 'prompt') draft.current?.focus();
    else dialog.current?.querySelector<HTMLButtonElement>('.fork-menu-row')?.focus();
  }, [step, models]);

  const run = (placement: Placement) => {
    onRun({
      sourceThreadId: source.threadId,
      ...(source.sourceSeqEnd === undefined ? {} : { sourceSeqEnd: source.sourceSeqEnd }),
      placement, worktree,
      ...(count > 1 ? { count } : {}),
      ...(model ? { model } : {}),
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
    });
  };
  const copyCommand = () => onCopy(forkCommand({ sourceThreadId: source.threadId, sourceSeqEnd: source.sourceSeqEnd, worktree }), 'fork command');
  const copyId = () => onCopy(source.threadId, 'thread id');
  const pickModel = (entry: Model, effort: ReasoningLevel | null) => {
    setModel({ model: entry.model, label: effort ? `${entry.label} · ${effort}` : entry.label, ...(effort ? { reasoningLevel: effort } : {}) });
    setStep({ kind: 'main' });
  };

  function keyboard(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const onRow = event.target instanceof HTMLButtonElement;
    const digit = /^[1-9]$/u.test(event.key) ? Number(event.key) : null;
    const handled = () => event.preventDefault();
    switch (step.kind) {
      case 'prompt':
        if (event.key === 'Enter' && !event.shiftKey) { handled(); setStep({ kind: 'main' }); }
        return;
      case 'model':
        if (digit !== null && models?.[digit - 1]) { handled(); setStep({ kind: 'effort', model: models[digit - 1]! }); }
        else if (event.key === 'x') { handled(); setModel(null); setStep({ kind: 'main' }); }
        return;
      case 'effort':
        if (digit !== null && step.model.efforts[digit - 1]) { handled(); pickModel(step.model, step.model.efforts[digit - 1]!); }
        else if (event.key === 'Enter' && !onRow) { handled(); pickModel(step.model, step.model.defaultEffort); }
        return;
      case 'main':
        break;
    }
    const placement = placementKeys[event.key];
    if (placement) { handled(); run(placement); }
    else if (event.key === 'Enter' && !onRow) { handled(); run('switch'); }
    else if (digit !== null && digit <= MAX_COUNT) { handled(); setCount(digit); }
    else if (event.key === 'w') { handled(); setWorktree(on => !on); }
    else if (event.key === 'm') { handled(); setStep({ kind: 'model' }); }
    else if (event.key === 'p') { handled(); setStep({ kind: 'prompt' }); }
    else if (event.key === 'c') { handled(); copyCommand(); }
    else if (event.key === 'y') { handled(); copyId(); }
  }

  const options = [
    count > 1 ? `×${count}` : null,
    worktree ? 'new worktree' : null,
    model ? model.label : null,
    prompt.trim() ? 'with prompt' : null,
  ].filter(Boolean).join(' · ');
  const heading = source.sourceSeqEnd === undefined ? 'Fork thread' : 'Fork from this message';

  let body: ReactNode;
  switch (step.kind) {
    case 'main':
      body = <>
        <div className="fork-menu-group">
          <Row keys="⏎" label="Switch to fork" onPick={() => run('switch')} />
          <Row keys="s" label="Side panel" detail="stay here, fork beside" onPick={() => run('sidebar')} />
          <Row keys="| →" label="Split right" onPick={() => run('right')} />
          <Row keys="←" label="Split left" onPick={() => run('left')} />
          <Row keys="- ↓" label="Split down" onPick={() => run('down')} />
          <Row keys="↑" label="Split up" onPick={() => run('top')} />
        </div>
        <div className="fork-menu-group">
          <Row keys="2–8" label="Fork count" detail={count > 1 ? `×${count}` : '×1'} onPick={() => setCount(n => n >= MAX_COUNT ? 1 : n + 1)} />
          <Row keys="w" label="New worktree" detail={worktree ? 'on' : 'off'} onPick={() => setWorktree(on => !on)} />
          <Row keys="m" label="Model" detail={model?.label ?? 'same'} onPick={() => setStep({ kind: 'model' })} />
          <Row keys="p" label="First prompt" detail={prompt.trim() ? 'set' : 'none'} onPick={() => setStep({ kind: 'prompt' })} />
        </div>
        <div className="fork-menu-group">
          <Row keys="c" label="Copy fork command" onPick={copyCommand} />
          <Row keys="y" label="Copy thread id" onPick={copyId} />
        </div>
      </>;
      break;
    case 'model':
      body = modelError ? <p role="alert" className="fork-menu-note">Models failed to load: {modelError}</p>
        : !models ? <p role="status" className="fork-menu-note">Loading models…</p>
        : <div className="fork-menu-group">
          {models.slice(0, 9).map((entry, index) =>
            <Row key={entry.model} keys={String(index + 1)} label={entry.label} onPick={() => setStep({ kind: 'effort', model: entry })} />)}
          <Row keys="x" label="Keep the source model" onPick={() => { setModel(null); setStep({ kind: 'main' }); }} />
        </div>;
      break;
    case 'effort':
      body = <div className="fork-menu-group">
        <Row keys="⏎" label="Default effort" detail={step.model.defaultEffort ?? undefined} onPick={() => pickModel(step.model, step.model.defaultEffort)} />
        {step.model.efforts.slice(0, 9).map((effort, index) =>
          <Row key={effort} keys={String(index + 1)} label={effort} onPick={() => pickModel(step.model, effort)} />)}
      </div>;
      break;
    case 'prompt':
      body = <label className="fork-menu-prompt">
        <span>First prompt. Enter saves, Shift+Enter adds a line.</span>
        <textarea ref={draft} rows={4} value={prompt} onChange={event => setPrompt(event.target.value)} />
      </label>;
      break;
  }

  return <ChipPopover ref={dialog} aria-label={heading} trigger={() => returnFocus} anchor={null} width={width} place={centred} instant
    panelClassName="fork-menu" onClose={onClose} onKeyDown={keyboard}
    onEscape={step.kind === 'main' ? onClose : () => setStep(step.kind === 'effort' ? { kind: 'model' } : { kind: 'main' })}>
    <header className="fork-menu-heading">
      <span>{step.kind === 'model' || step.kind === 'effort' ? 'Fork with model' : heading}</span>
      {options ? <span className="fork-menu-detail">{options}</span> : null}
    </header>
    {body}
  </ChipPopover>;
}
