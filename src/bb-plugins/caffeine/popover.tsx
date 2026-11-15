import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import type { Details, CaffeineView, ActionResult } from './src/domain.ts';
import { GRACE_MS } from './src/agents.ts';
import { clockAt, durationLabel, EXTEND_OPTIONS, longDuration, remainingFraction, START_OPTIONS, untilLabel } from './src/format.ts';
import { ARMED_MS, press, type Armed } from './src/confirm.ts';
import { keyAction, rowId, type Action, type Screen } from './src/keys.ts';
import { act, dismissError, message, rpc, useNow, visibleChip, type ActionError, type ActionLabel, type Anchor } from './store.ts';

const UNSUPPORTED: Record<Extract<CaffeineView, { kind: 'unsupported' }>['reason'], string> = {
  'not-macos': 'Keep awake works only on macOS.',
  'no-caffeinate': 'This Mac has no caffeinate binary, so there is nothing to toggle.',
  'no-lib': 'Keep awake drives the tmux caffeine subsystem, and ~/.config/tmux/scripts/caffeine-lib.sh is missing.',
  'no-host': 'BB has no primary host.',
};

type Tone = 'off' | 'on' | 'lid';

function screenOf(view: CaffeineView | null, picker: boolean, stuck: boolean): Screen {
  if (!view || view.kind === 'unsupported') return { kind: 'unsupported' };
  if (view.kind === 'off') return picker ? { kind: 'lid-picker' } : { kind: 'off', stuck };
  if (view.kind === 'on') return { kind: 'on', timed: view.deadline !== null, stuck };
  if (view.kind === 'agents') return { kind: 'agents', stuck };
  return { kind: 'lid' };
}

/** Where focus lands when a screen opens: the likeliest next key. */
function initialRow(screen: Screen): string | null {
  switch (screen.kind) {
    case 'off': return rowId({ kind: 'start', secs: 0 });
    case 'lid-picker': return rowId({ kind: 'startLid', secs: START_OPTIONS[0] });
    case 'on': return screen.timed ? rowId({ kind: 'extend', add: EXTEND_OPTIONS[0] }) : 'off';
    case 'lid': return rowId({ kind: 'extend', add: EXTEND_OPTIONS[0] });
    case 'agents': return 'off';
    case 'unsupported': return null;
  }
}

/**
 * disabled is aria-only: a disabled button drops focus to <body>, outside the popover's keys. dispatch ignores the click.
 * A double-click is one press, so it cannot pass a second-press confirm on its own.
 */
function Row({ id, keycap, label, aside, sub, tone, armed, disabled, onClick }: {
  id: string; keycap: string; label: ReactNode; aside?: ReactNode; sub?: string; tone?: 'lid' | 'warn';
  armed?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <button type="button" className="cf-row" data-row={id} data-tone={tone} data-armed={armed || undefined}
    aria-disabled={disabled || undefined} onClick={event => { if (event.detail < 2) onClick(); }}>
    <kbd>{keycap}</kbd>
    <span className="cf-row-main">
      <span className="cf-row-label">{label}</span>
      {sub && <span className="cf-row-sub">{sub}</span>}
    </span>
    {aside !== undefined && <span className="cf-row-aside">{aside}</span>}
  </button>;
}

function Meter({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(fraction * 100);
  return <span className="cf-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
    <i style={{ width: `${pct}%` }} />
  </span>;
}

function Header({ id, tone, glyph, title, tag, children }: { id: string; tone: Tone; glyph: string; title: string; tag: string; children?: ReactNode }) {
  return <header id={id} className="cf-header" data-tone={tone}>
    <div className="cf-title">
      <span className="cf-glyph cf-title-glyph" data-tone={tone} aria-hidden>{glyph}</span>
      <h2>{title}</h2>
      <span className="cf-tag">{tag}</span>
    </div>
    {children}
  </header>;
}

function Recovery({ onClear }: { onClear: () => void }) {
  return <section className="cf-section cf-recovery" aria-label="Sleep is still disabled">
    <Row id="clear" keycap="c" tone="lid" onClick={onClear}
      label={<><span className="cf-warn-glyph" aria-hidden>⚠</span> This Mac still cannot sleep at all.</>}
      sub="A lid session left the kernel flag set. Clear now, or it clears within 5 min." />
  </section>;
}

const LABELS = {
  start: { doing: 'Starting keep-awake', failed: 'Start' },
  startLid: { doing: 'Starting lid mode', failed: 'Lid start' },
  extend: { doing: 'Extending', failed: 'Extend' },
  agents: { doing: 'Starting agents mode', failed: 'Agents mode' },
  off: { doing: 'Turning off', failed: 'Turn off' },
  clear: { doing: 'Clearing the sleep flag', failed: 'Clear' },
} satisfies Record<string, ActionLabel>;

const noChip = () => null;

export function CaffeinePopover({ view, readError, pending, actionError, anchor, instant, fromChip, onClose }: {
  view: CaffeineView | null; readError: string | null; pending: ActionLabel | null; actionError: ActionError | null;
  anchor: Anchor; instant: boolean; fromChip: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headerId = useId();
  const statusId = useId();
  const [picker, setPicker] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const waiting = pending !== null;
  /** The row that needs a second press: a lid session on battery. */
  const [armed, setArmed] = useState<Armed | null>(null);
  const now = useNow(1_000);

  const stuck = details?.sleepDisabled === true;
  const screen = screenOf(view, picker, stuck);
  const onBattery = details?.onBattery === true;
  /** Only a known mains reading skips the lid confirm: details may still be loading, or may have failed. */
  const onMains = details?.onBattery === false;

  const loadDetails = useCallback(() => {
    rpc().call('details', {}).then(detail => { setDetails(detail); setDetailsError(null); }, cause => setDetailsError(message(cause)));
  }, []);

  useEffect(() => { loadDetails(); }, [loadDetails]);
  // Leaving OFF (a start from tmux, say) closes the lid picker with it.
  useEffect(() => { if (view?.kind !== 'off') setPicker(false); }, [view?.kind]);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), ARMED_MS);
    return () => clearTimeout(id);
  }, [armed]);

  const focusRow = useCallback((id: string | null) => {
    const row = id ? dialog.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`) : null;
    (row ?? dialog.current?.querySelector<HTMLElement>('[data-row]'))?.focus({ preventScroll: true });
  }, []);
  const screenKey = screen.kind === 'on' ? `on:${screen.timed}` : screen.kind;
  // An armed row belongs to its screen: a lid session that ends or becomes a normal one needs no confirm.
  useEffect(() => { setArmed(null); }, [screenKey]);
  /** Where focus goes when a screen opens in place of initialRow: the row the user came back from. */
  const returnTo = useRef<string | null>(null);
  // Keyed on the screen, not the view: the clock ticks every second and must not steal focus back.
  const initial = initialRow(screen);
  useEffect(() => {
    focusRow(returnTo.current ?? initial);
    returnTo.current = null;
  }, [screenKey, focusRow]);
  /** The row an action came from, so focus can return to it once the action settles. */
  const actedFrom = useRef<string | null>(null);
  // A cleared flag unmounts its row, which drops focus to <body>, outside the dialog's key handler. Put it back.
  useEffect(() => {
    const element = dialog.current;
    if (!element || element.contains(document.activeElement)) return;
    const from = actedFrom.current;
    focusRow(from && element.querySelector(`[data-row="${CSS.escape(from)}"]`) ? from : initial);
  });

  async function perform(label: ActionLabel, call: () => Promise<ActionResult>, closeOnSuccess = true) {
    actedFrom.current = (document.activeElement as HTMLElement | null)?.dataset?.row ?? null;
    setArmed(null);
    if (await act(label, call, closeOnSuccess) && !closeOnSuccess) loadDetails();
  }

  /** Lid sessions take a second press unless on mains; declining costs a running session nothing. */
  function confirmed(id: string): boolean {
    // performance.now: a gap between two presses, so wall-clock changes must not count.
    const result = press(armed, id, performance.now(), onMains);
    if (result.go) return true;
    setArmed(result.armed);
    focusRow(id);
    return false;
  }

  function dispatch(action: Action) {
    // One action at a time: while one runs, only moving, going back and closing work.
    if (waiting && action.kind !== 'close' && action.kind !== 'focus' && action.kind !== 'back') return;
    switch (action.kind) {
      case 'close': onClose(); return;
      case 'back': returnTo.current = 'lidPicker'; setPicker(false); return;
      case 'focus': focusRow(action.row); return;
      case 'lidPicker': dismissError(); setPicker(true); return;
      case 'start': void perform(LABELS.start, () => rpc().call('start', { secs: action.secs })); return;
      case 'startLid':
        if (confirmed(rowId(action))) void perform(LABELS.startLid, () => rpc().call('startLid', { secs: action.secs }));
        return;
      case 'extend':
        if (view?.kind === 'lid' && !confirmed(rowId(action))) return;
        void perform(LABELS.extend, () => rpc().call('extend', { add: action.add }));
        return;
      case 'agents': void perform(LABELS.agents, () => rpc().call('startAgents', {})); return;
      case 'off': void perform(LABELS.off, () => rpc().call('stop', {})); return;
      case 'clear': void perform(LABELS.clear, () => rpc().call('clearSleepDisabled', {}), false); return;
    }
  }

  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Disarm here, before the dialog's cancel: Chromium makes a second Escape cancel with no key between them
    // uncancelable, so a disarm spent on cancel would make the next Escape close the dialog instead of going back.
    if (event.key === 'Escape') {
      if (armed) { event.preventDefault(); setArmed(null); }
      return;
    }
    const rows = Array.from(dialog.current?.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)') ?? []);
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const move = (step: number) => {
      event.preventDefault();
      const next = rows[current < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, current + step))];
      next?.focus();
    };
    if (event.key === 'ArrowDown' || event.key === 'j') return move(1);
    if (event.key === 'ArrowUp' || event.key === 'k') return move(-1);
    // A held key is one press: auto-repeat must not pass a second-press confirm or fire Enter's click again.
    if (event.repeat) return event.preventDefault();
    if (event.key === 'Enter') return; // the focused row's own click
    const action = keyAction(screen, event.key);
    if (action) event.preventDefault();
    if (action) dispatch(action);
  }

  const tone: Tone = view?.kind === 'lid' || screen.kind === 'lid-picker' ? 'lid' : view?.kind === 'on' || view?.kind === 'agents' ? 'on' : 'off';

  /** What the armed row's next press does, for the live region: a changed button name is often not announced. */
  let armedNote: string | null = null;
  const power = onBattery ? 'on battery. This drains it, and a closed shell runs hot' : 'with the power source unknown';
  const isArmed = (id: string) => armed?.row === id;
  /** A stuck flag makes "the Mac sleeps" false, so the header says so instead. */
  const stuckLine = <p className="cf-line cf-alert">A lid session left this Mac unable to sleep, lid included.</p>;
  let body: ReactNode;
  let footnote: string;
  if (!view) {
    body = <Header id={headerId} tone="off" glyph="☼" title="Keep awake" tag={readError ? 'UNKNOWN' : '…'}>
      <p className="cf-line cf-muted">{readError ? "Could not read this Mac's state. Close and reopen to try again." : "Reading this Mac's state…"}</p>
    </Header>;
    footnote = '';
  } else if (view.kind === 'unsupported') {
    body = <Header id={headerId} tone="off" glyph="☼" title="Keep awake" tag="UNAVAILABLE"><p className="cf-line">{UNSUPPORTED[view.reason]}</p></Header>;
    footnote = '';
  } else if (screen.kind === 'lid-picker') {
    body = <>
      <Header id={headerId} tone="lid" glyph="✷" title="Keep awake with the lid closed" tag="LID">
        <p className="cf-line cf-muted">Always timed. Nothing will sleep this Mac, lid or not.</p>
      </Header>
      {onBattery && <p className="cf-banner" role="note">
        On battery. This drains it flat, and a closed shell has no airflow, so it runs hot. Plug in first, or move the work with <code>atp --host dev</code>.
      </p>}
      <section className="cf-section">
        {START_OPTIONS.map((secs, index) => {
          const id = rowId({ kind: 'startLid', secs });
          if (isArmed(id)) armedNote = `Press ${index + 1} again to keep this Mac awake with the lid closed for ${durationLabel(secs)}, ${power}.`;
          return <Row key={secs} id={id} keycap={String(index + 1)} armed={isArmed(id)} disabled={waiting}
            label={isArmed(id) ? (onBattery ? 'Press again to start on battery' : 'Press again to start, power unknown') : durationLabel(secs)}
            aside={untilLabel(now + secs * 1000, now)} onClick={() => dispatch({ kind: 'startLid', secs })} />;
        })}
      </section>
    </>;
    footnote = 'Clears itself at the end, and normal sleep returns.';
  } else if (view.kind === 'off') {
    const unread = detailsError ? 'unknown' : '…';
    const busy = details ? (details.busyNow ? `${details.busyNow} running` : 'none running') : unread;
    const power = details ? (details.onBattery === true ? <span className="cf-battery">on battery</span> : details.onBattery === false ? 'on mains' : '') : detailsError ? 'power unknown' : '…';
    body = <>
      <Header id={headerId} tone="off" glyph="☼" title="Keep awake" tag="OFF">
        {stuck ? stuckLine : <p className="cf-line cf-muted">This Mac sleeps on its normal schedule.</p>}
      </Header>
      <section className="cf-section">
        <Row id={rowId({ kind: 'start', secs: 0 })} keycap="i" label="Indefinitely" aside="∞" disabled={waiting}
          onClick={() => dispatch({ kind: 'start', secs: 0 })} />
        {START_OPTIONS.map((secs, index) => <Row key={secs} id={rowId({ kind: 'start', secs })} keycap={String(index + 1)} disabled={waiting}
          label={durationLabel(secs)} aside={untilLabel(now + secs * 1000, now)} onClick={() => dispatch({ kind: 'start', secs })} />)}
        <Row id="agents" keycap="a" label="While agents run" aside={busy} disabled={waiting}
          sub="Stays on while threads on this Mac run, then 5 min after the last one stops."
          onClick={() => dispatch({ kind: 'agents' })} />
        <Row id="lidPicker" keycap="l" tone="lid" disabled={waiting}
          label={<>Lid closed <span className="cf-glyph" data-tone="lid" aria-hidden>✷</span></>}
          aside={<>{power}<span className="cf-chevron" aria-hidden>›</span></>} onClick={() => dispatch({ kind: 'lidPicker' })} />
      </section>
      {stuck && <Recovery onClear={() => dispatch({ kind: 'clear' })} />}
    </>;
    footnote = 'Holds system sleep; displays still sleep.';
  } else if (view.kind === 'on' || view.kind === 'lid') {
    const lid = view.kind === 'lid';
    const deadline = view.deadline;
    body = <>
      <Header id={headerId} tone={lid ? 'lid' : 'on'} glyph={lid ? '✷' : '☼'} title="Keep awake" tag={lid ? 'ON-LID' : 'ON'}>
        <p className="cf-line cf-strong">{deadline === null ? 'Indefinitely' : `${longDuration((deadline - now) / 1000)} left · ${untilLabel(deadline, now)}`}</p>
        {deadline !== null && <Meter fraction={remainingFraction(now, view.startedAt, deadline)} label="Time left" />}
        {lid
          ? <p className="cf-line cf-muted">You can close the lid. This Mac cannot sleep at all. It self-clears at {clockAt(deadline!, now)} and normal sleep returns.</p>
          : stuck
          ? <><p className="cf-line cf-muted">System sleep is held; displays still sleep.</p>{stuckLine}</>
          : <p className="cf-line cf-muted">System sleep is held; displays still sleep. Closing the lid still sleeps the Mac.</p>}
      </Header>
      {lid && onBattery && <p className="cf-banner" role="note">On battery. Extending keeps it draining, and a closed shell runs hot.</p>}
      <section className="cf-section">
        {deadline !== null && EXTEND_OPTIONS.map((add, index) => {
          const id = rowId({ kind: 'extend', add });
          if (isArmed(id)) armedNote = `Press ${index + 1} again to extend lid mode by ${durationLabel(add)}, ${power}.`;
          return <Row key={add} id={id} keycap={String(index + 1)} armed={isArmed(id)} disabled={waiting}
            label={isArmed(id) ? (onBattery ? 'Press again to extend on battery' : 'Press again to extend, power unknown') : `+${durationLabel(add)}`}
            aside={untilLabel(deadline + add * 1000, now)} onClick={() => dispatch({ kind: 'extend', add })} />;
        })}
        <Row id="off" keycap="o" label="Turn off" disabled={waiting} onClick={() => dispatch({ kind: 'off' })} />
      </section>
      {!lid && stuck && <Recovery onClear={() => dispatch({ kind: 'clear' })} />}
    </>;
    footnote = lid ? 'Extending restarts the session with the time added.' : deadline === null ? '' : 'Extending adds to what is left.';
  } else {
    const grace = view.graceUntil;
    body = <>
      <Header id={headerId} tone="on" glyph="☼" title="Keep awake" tag="WHILE AGENTS RUN">
        {grace !== null
          ? <>
            <p className="cf-line cf-strong">{grace - now >= 1_000
              ? `No agents running. Stops in ${longDuration((grace - now) / 1000)}, at ${clockAt(grace, now)}.`
              : 'No agents running. Stopping now.'}</p>
            <Meter fraction={Math.min(1, Math.max(0, (grace - now) / GRACE_MS))} label="Grace period left" />
          </>
          : view.busy !== null
          ? <>
            <p className="cf-line cf-strong">{view.busy === 1 ? '1 agent' : `${view.busy} agents`} running on this Mac.</p>
            <p className="cf-line cf-muted">Stops 5 min after the last one goes idle.</p>
          </>
          : <p className="cf-line cf-muted">Counting agents on this Mac…</p>}
      </Header>
      <section className="cf-section">
        <Row id="off" keycap="o" label="Turn off" disabled={waiting} onClick={() => dispatch({ kind: 'off' })} />
      </section>
      {stuck && <Recovery onClear={() => dispatch({ kind: 'clear' })} />}
    </>;
    footnote = 'Starting or changing keep-awake by hand ends agents mode.';
  }

  const failure = actionError && (actionError.missed
    ? `${actionError.label.failed} failed at ${clockAt(actionError.at, now)}: ${actionError.reason}`
    : `${actionError.label.failed} failed: ${actionError.reason}`);
  const shownError = failure ?? (detailsError && `Could not read power and running agents: ${detailsError}`) ?? (view ? null : readError);
  const keys = screen.kind === 'unsupported'
    ? <><kbd>q</kbd> close</>
    : <><span className="cf-pair"><kbd>↑</kbd><kbd>↓</kbd></span> move <kbd>↵</kbd> choose {screen.kind === 'lid-picker' ? <><kbd>esc</kbd> back</> : <><kbd>q</kbd> close</>}</>;
  return <ChipPopover ref={dialog} className="cf-dialog cf-root" panelClassName="cf-panel" aria-label="Keep awake" aria-busy={waiting || undefined}
    aria-describedby={`${headerId} ${statusId}`} onKeyDown={keyboard} trigger={fromChip ? visibleChip : noChip} anchor={anchor} width={320} instant={instant} data-tone={tone} onClose={onClose}
    onEscape={() => {
      const action = keyAction(screen, 'Escape');
      if (action) dispatch(action);
    }}>
    {body}
    {/* One live region, present from the first render, so a later error or status is announced. */}
    <div role="status" id={statusId}>
      {pending ? <p className="cf-pending">{pending.doing}…</p> : shownError && <p className="cf-error">{shownError}</p>}
      {armedNote && <p className="cf-sr-only">{armedNote}</p>}
    </div>
    <footer className="cf-footer">
      {footnote && <span>{footnote}</span>}
      <span className="cf-keys">{keys}</span>
    </footer>
  </ChipPopover>;
}
