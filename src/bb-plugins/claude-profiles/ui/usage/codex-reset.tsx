import { useEffect, useId, useRef, useState } from 'react';
import { useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from '../../contracts.ts';
import type { ResetAction, ResetState } from '../../src/accounts/usage/codex-reset.ts';

export function CodexReset({ hostId, connected }: { hostId: string; connected: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ResetState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState('98');
  const version = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    function read() {
      if (writing.current) return;
      const request = ++version.current;
      void rpc.call('codexReset.status', { hostId }).then(value => {
        if (active && version.current === request) { setStatus(value); setFailure(null); }
      }).catch(() => {
        if (active && version.current === request) setFailure('Could not read auto-reset on this machine.');
      });
    }
    read();
    const timer = window.setInterval(read, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [connected, hostId, rpc]);

  async function apply(action: ResetAction) {
    if (writing.current) return;
    writing.current = true;
    version.current++;
    setBusy(true);
    setFailure(null);
    try { setStatus(await rpc.call('codexReset.set', { hostId, action })); }
    catch { setFailure('Could not confirm the change. Check this machine’s Codex login and try again.'); }
    finally { writing.current = false; setBusy(false); }
  }

  const valid = trigger === 'blocked' || /^[0-9]{1,3}$/.test(trigger) && Number(trigger) >= 1 && Number(trigger) <= 100;
  const selected = trigger === 'blocked' ? trigger : Number(trigger);
  const mode = status?.review ? 'Review needed' : status?.mode === 'once' ? 'Armed once' : status?.mode === 'always' ? 'Always armed' : status ? 'Off' : null;
  return <div className="au-auto-reset">
    <button type="button" className="au-login-button" aria-expanded={open} aria-controls={id} onClick={() => {
      if (!open && status) setTrigger(String(status.trigger));
      setOpen(!open);
    }}>Auto-reset{mode ? ` · ${mode}` : ''}</button>
    {open && <div id={id} className="au-auto-reset-controls">
      {!connected ? <p>Connect this machine to change auto-reset.</p> : <>
        {failure && <p role="alert">{failure}</p>}
        <p role="status">{status?.message ?? (failure ? '' : 'Checking auto-reset…')}</p>
        {status && status.mode !== 'off' && <p>Armed for {status.trigger === 'blocked' ? 'blocked usage' : `${status.trigger}% usage`}.</p>}
        {status?.lastReset && status.lastReset !== status.message && <p>{status.lastReset}</p>}
        {status && <>
          <p>Applies to this machine’s Codex CLI login.</p>
          <label>Trigger <select value={trigger === 'blocked' ? 'blocked' : 'percentage'} disabled={busy || status.review}
            onChange={event => setTrigger(event.target.value === 'blocked' ? 'blocked' : '98')}>
            <option value="percentage">Usage percentage</option>
            <option value="blocked">Codex blocks usage</option>
          </select></label>
          {trigger !== 'blocked' && <label>Usage threshold (%) <input type="number" inputMode="numeric" min="1" max="100"
            value={trigger} disabled={busy || status.review} onChange={event => setTrigger(event.target.value)} /></label>}
          <p>{trigger === 'blocked' ? 'Waits until Codex blocks ordinary usage.' : 'Either the five-hour or weekly window can reach the threshold.'}</p>
          <div className="au-auto-reset-actions">
            <button type="button" className="au-login-button" disabled={busy || status.mode === 'off' && !status.review}
              onClick={() => void apply({ mode: 'off' })}>Off</button>
            <button type="button" className="au-login-button" disabled={busy || status.review || !valid}
              onClick={() => void apply({ mode: 'once', trigger: selected })}>Arm once</button>
            <button type="button" className="au-login-button" disabled={busy || status.review || !valid}
              onClick={() => void apply({ mode: 'always', trigger: selected })}>Always</button>
          </div>
        </>}
      </>}
    </div>}
  </div>;
}
