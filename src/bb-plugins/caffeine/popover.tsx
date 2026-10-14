import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChipPopover } from '@bb-plugins/chip';
import type { Details, CaffeineView, ActionResult } from './src/domain.ts';
import { GRACE_MS } from './src/agents.ts';
import { clockAt, durationLabel, EXTEND_OPTIONS, longDuration, remainingFraction, START_OPTIONS, untilLabel } from './src/format.ts';
import { keyAction, rowId, type Action, type Screen } from './src/keys.ts';
import { message, rpc, useNow, visibleChip, type Anchor } from './store.ts';

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

function Row({ id, keycap, label, aside, sub, tone, armed, disabled, onClick }: {
  id: string; keycap: string; label: ReactNode; aside?: ReactNode; sub?: string; tone?: 'lid' | 'warn';
  armed?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return <button type="button" className="cf-row" data-row={id} data-tone={tone} data-armed={armed || undefined}
    disabled={disabled} onClick={onClick}>
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

function Header({ tone, glyph, title, tag, children }: { tone: Tone; glyph: string; title: string; tag: string; children?: ReactNode }) {
  return <header className="cf-header" data-tone={tone}>
    <div className="cf-title">
      <span className="cf-glyph cf-title-glyph" data-tone={tone}>{glyph}</span>
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

export function CaffeinePopover({ view, anchor, instant, onClose }: {
  view: CaffeineView | null; anchor: Anchor; instant: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [picker, setPicker] = useState(false);
  const [details, setDetails] = useState<Details | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** The row that needs a second press: a lid session on battery. */
  const [armed, setArmed] = useState<string | null>(null);
  const now = useNow(1_000);

  const stuck = details?.sleepDisabled === true;
  const screen = screenOf(view, picker, stuck);
  const onBattery = details?.onBattery === true;
  /** Only a known mains reading skips the lid confirm: details may still be loading, or may have failed. */
  const onMains = details?.onBattery === false;

  const loadDetails = useCallback(() => {
    rpc().call('details', {}).then(setDetails, cause => setError(message(cause)));
  }, []);

  useEffect(() => { loadDetails(); }, [loadDetails]);
  // Leaving OFF (a start from tmux, say) closes the lid picker with it.
  useEffect(() => { if (view?.kind !== 'off') setPicker(false); }, [view?.kind]);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 4_000);
    return () => clearTimeout(id);
  }, [armed]);

  const focusRow = useCallback((id: string | null) => {
    const row = id ? dialog.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`) : null;
    (row ?? dialog.current?.querySelector<HTMLElement>('[data-row]'))?.focus({ preventScroll: true });
  }, []);
  const screenKey = screen.kind === 'on' ? `on:${screen.timed}` : screen.kind;
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
  // A pending action disables every row and a cleared flag unmounts its row;
  // either drops focus to <body>, outside the dialog's key handler. Put it back.
  useEffect(() => {
    const element = dialog.current;
    if (pending || !element || element.contains(document.activeElement)) return;
    const from = actedFrom.current;
    focusRow(from && element.querySelector(`[data-row="${CSS.escape(from)}"]`) ? from : initial);
  });

  async function perform(call: () => Promise<ActionResult>, closeOnSuccess = true) {
    if (pending) return;
    actedFrom.current = (document.activeElement as HTMLElement | null)?.dataset?.row ?? null;
    setPending(true);
    setError(null);
    setArmed(null);
    try {
      const result = await call();
      if (!result.ok) setError(result.reason);
      else if (closeOnSuccess) onClose();
      else loadDetails();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setPending(false);
    }
  }

  /** Lid sessions take a second press unless on mains; declining costs a running session nothing. */
  function confirmed(id: string): boolean {
    if (onMains || armed === id) return true;
    setArmed(id);
    focusRow(id);
    return false;
  }

  function dispatch(action: Action) {
    switch (action.kind) {
      case 'close': onClose(); return;
      case 'back': returnTo.current = 'lidPicker'; setPicker(false); return;
      case 'focus': focusRow(action.row); return;
      case 'lidPicker': setError(null); setPicker(true); return;
      case 'start': void perform(() => rpc().call('start', { secs: action.secs })); return;
      case 'startLid':
        if (confirmed(rowId(action))) void perform(() => rpc().call('startLid', { secs: action.secs }));
        return;
      case 'extend':
        if (view?.kind === 'lid' && !confirmed(rowId(action))) return;
        void perform(() => rpc().call('extend', { add: action.add }));
        return;
      case 'agents': void perform(() => rpc().call('startAgents', {})); return;
      case 'off': void perform(() => rpc().call('stop', {})); return;
      case 'clear': void perform(() => rpc().call('clearSleepDisabled', {}), false); return;
    }
  }

  function keyboard(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.key === 'Escape') return;
    const rows = Array.from(dialog.current?.querySelectorAll<HTMLElement>('[data-row]:not(:disabled)') ?? []);
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const move = (step: number) => {
      event.preventDefault();
      const next = rows[current < 0 ? (step > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, current + step))];
      next?.focus();
    };
    if (event.key === 'ArrowDown' || event.key === 'j') return move(1);
    if (event.key === 'ArrowUp' || event.key === 'k') return move(-1);
    if (event.key === 'Enter') return; // the focused row's own click
    const action = keyAction(screen, event.key);
    if (action) event.preventDefault();
    if (action) dispatch(action);
  }

  const tone: Tone = view?.kind === 'lid' || screen.kind === 'lid-picker' ? 'lid' : view?.kind === 'on' || view?.kind === 'agents' ? 'on' : 'off';

  let body: ReactNode;
  let footnote: string;
  if (!view) {
    body = <Header tone="off" glyph="☼" title="Keep awake" tag="…"><p className="cf-line cf-muted">Reading this Mac's state…</p></Header>;
    footnote = '';
  } else if (view.kind === 'unsupported') {
    body = <Header tone="off" glyph="☼" title="Keep awake" tag="UNAVAILABLE"><p className="cf-line">{UNSUPPORTED[view.reason]}</p></Header>;
    footnote = '';
  } else if (screen.kind === 'lid-picker') {
    body = <>
      <Header tone="lid" glyph="✷" title="Keep awake with the lid closed" tag="LID">
        <p className="cf-line cf-muted">Always timed. Nothing will sleep this Mac, lid or not.</p>
      </Header>
      {onBattery && <p className="cf-banner" role="note">
        On battery. This drains it flat, and a closed shell has no airflow, so it runs hot. Plug in first, or move the work with <code>atp --host dev</code>.
      </p>}
      <section className="cf-section">
        {START_OPTIONS.map((secs, index) => {
          const id = rowId({ kind: 'startLid', secs });
          return <Row key={secs} id={id} keycap={String(index + 1)} armed={armed === id} disabled={pending}
            label={armed === id ? (onBattery ? 'Press again to start on battery' : 'Press again to start, power unknown') : durationLabel(secs)}
            aside={untilLabel(now + secs * 1000)} onClick={() => dispatch({ kind: 'startLid', secs })} />;
        })}
      </section>
    </>;
    footnote = 'Clears itself at the end, and normal sleep returns.';
  } else if (view.kind === 'off') {
    const busy = details ? (details.busyNow ? `${details.busyNow} running` : 'none running') : '…';
    const power = details ? (details.onBattery === true ? <span className="cf-battery">on battery</span> : details.onBattery === false ? 'on mains' : '') : '…';
    body = <>
      <Header tone="off" glyph="☼" title="Keep awake" tag="OFF">
        <p className="cf-line cf-muted">This Mac sleeps on its normal schedule.</p>
      </Header>
      <section className="cf-section">
        <Row id={rowId({ kind: 'start', secs: 0 })} keycap="i" label="Indefinitely" aside="∞" disabled={pending}
          onClick={() => dispatch({ kind: 'start', secs: 0 })} />
        {START_OPTIONS.map((secs, index) => <Row key={secs} id={rowId({ kind: 'start', secs })} keycap={String(index + 1)} disabled={pending}
          label={durationLabel(secs)} aside={untilLabel(now + secs * 1000)} onClick={() => dispatch({ kind: 'start', secs })} />)}
        <Row id="agents" keycap="a" label="While agents run" aside={busy} disabled={pending}
          sub="Stays on while threads on this Mac run, then 5 min after the last one stops."
          onClick={() => dispatch({ kind: 'agents' })} />
        <Row id="lidPicker" keycap="l" tone="lid" disabled={pending}
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
      <Header tone={lid ? 'lid' : 'on'} glyph={lid ? '✷' : '☼'} title="Keep awake" tag={lid ? 'ON-LID' : 'ON'}>
        <p className="cf-line cf-strong">{deadline === null ? 'Indefinitely' : `${longDuration((deadline - now) / 1000)} left · ${untilLabel(deadline)}`}</p>
        {deadline !== null && <Meter fraction={remainingFraction(now, view.startedAt, deadline)} label="Time left" />}
        {lid
          ? <p className="cf-line cf-muted">You can close the lid. This Mac cannot sleep at all. It self-clears at {clockAt(deadline!)} and normal sleep returns.</p>
          : <p className="cf-line cf-muted">System sleep is held; displays still sleep. Closing the lid still sleeps the Mac.</p>}
      </Header>
      {lid && onBattery && <p className="cf-banner" role="note">On battery. Extending keeps it draining, and a closed shell runs hot.</p>}
      <section className="cf-section">
        {deadline !== null && EXTEND_OPTIONS.map((add, index) => {
          const id = rowId({ kind: 'extend', add });
          return <Row key={add} id={id} keycap={String(index + 1)} armed={armed === id} disabled={pending}
            label={armed === id ? (onBattery ? 'Press again to extend on battery' : 'Press again to extend, power unknown') : `+${durationLabel(add)}`}
            aside={untilLabel(deadline + add * 1000)} onClick={() => dispatch({ kind: 'extend', add })} />;
        })}
        <Row id="off" keycap="o" label="Turn off" disabled={pending} onClick={() => dispatch({ kind: 'off' })} />
      </section>
      {!lid && stuck && <Recovery onClear={() => dispatch({ kind: 'clear' })} />}
    </>;
    footnote = lid ? 'Extending restarts the session with the time added.' : 'Extending adds to what is left.';
  } else {
    const grace = view.graceUntil;
    body = <>
      <Header tone="on" glyph="☼" title="Keep awake" tag="WHILE AGENTS RUN">
        {grace !== null
          ? <>
            <p className="cf-line cf-strong">No agents running. Stops in {longDuration((grace - now) / 1000)}, at {clockAt(grace)}.</p>
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
        <Row id="off" keycap="o" label="Turn off" disabled={pending} onClick={() => dispatch({ kind: 'off' })} />
      </section>
      {stuck && <Recovery onClear={() => dispatch({ kind: 'clear' })} />}
    </>;
    footnote = 'Starting or changing keep-awake by hand ends agents mode.';
  }

  const keys = screen.kind === 'unsupported'
    ? <><kbd>q</kbd> close</>
    : <><kbd>↑</kbd><kbd>↓</kbd> move <kbd>↵</kbd> choose {screen.kind === 'lid-picker' ? <><kbd>esc</kbd> back</> : <><kbd>q</kbd> close</>}</>;
  return <ChipPopover ref={dialog} className="cf-dialog cf-root" panelClassName="cf-panel" aria-label="Keep awake" aria-busy={pending || undefined}
    onKeyDown={keyboard} trigger={visibleChip} anchor={anchor} width={320} instant={instant} data-tone={tone} onClose={onClose}
    onEscape={() => {
      if (armed) { setArmed(null); return; }
      const action = keyAction(screen, 'Escape');
      if (action) dispatch(action);
    }}>
    {body}
    {error && <p className="cf-error" role="status">{error}</p>}
    <footer className="cf-footer">
      {footnote && <span>{footnote}</span>}
      <span className="cf-keys">{keys}</span>
    </footer>
  </ChipPopover>;
}
