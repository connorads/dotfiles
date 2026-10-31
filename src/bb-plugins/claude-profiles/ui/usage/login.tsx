import { useCallback, useEffect, useRef, useState } from 'react';
import { useBbNavigate, useRpc, useSdk, type PluginNavPanelProps } from '@get-bb/plugin-sdk/app';
import { z } from 'zod';
import type { rpcContract } from '../../contracts.ts';
import type { LoginMethod } from '../../src/accounts/usage/contract.ts';
import { openUsage } from './overlay-store.ts';
import { openCodeAccountHost } from '../../src/accounts/usage/opencode.ts';

const targetSchema = z.object({ hostId: z.string(), accountId: z.string() });
const isCodex = (subPath: string | undefined) => decodeURIComponent(subPath ?? '').includes('"provider-codex:');

export function LoginPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [attempt, setAttempt] = useState(0);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const codex = isCodex(subPath);
  const opencode = (() => {
    try { return openCodeAccountHost(targetSchema.parse(JSON.parse(decodeURIComponent(subPath ?? ''))).accountId) !== null; }
    catch { return false; }
  })();
  const name = codex ? 'Codex' : opencode ? 'OpenCode Go' : 'Claude';
  const [method, setMethod] = useState<LoginMethod>('device');
  const [message, setMessage] = useState(`Opening ${name} sign-in…`);
  const [error, setError] = useState<string | null>(null);
  const [canCheck, setCanCheck] = useState(false);
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  // Keep navigation from restarting the login when the terminal panel opens.
  const navigation = useRef(navigate);
  navigation.current = navigate;
  const refreshGoAccess = useCallback(async (alive: () => boolean) => {
    setChecking(true);
    setError(null);
    try {
      const target = targetSchema.parse(JSON.parse(decodeURIComponent(subPath ?? '')));
      const inspection = await rpc.call('usage.inspection', { refresh: true });
      if (!alive()) return;
      const usage = inspection.snapshot.machines.find(machine => machine.id === target.hostId)
        ?.providers.find(account => account.id === target.accountId)?.usage;
      if (usage?.status !== 'ok') {
        setMessage('Key saved. Go access needs attention.');
        setError(usage?.status === 'expired' || usage?.status === 'unauthenticated'
          ? 'BB could not authenticate the Go key. Create a Personal API key in the subscribed workspace, then try again.'
          : 'Go access could not be verified. Check the subscription in OpenCode Console, then check access again.');
        return;
      }
      setCanCheck(false);
      setMessage('Signed in. Usage refreshed.');
      openUsage();
    } catch {
      if (alive()) {
        setMessage('Key saved. Go access needs attention.');
        setError('Go access could not be verified. Check access again when the service is available.');
      }
    } finally { if (alive()) setChecking(false); }
  }, [rpc, subPath]);
  useEffect(() => {
    generation.current++;
    if (!subPath) { setMessage('Choose Sign in again beside an account in Agent usage.'); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    setCanCheck(false);
    setChecking(false);
    setTerminalId(null);
    setMessage(`Opening ${name} sign-in…`);
    async function start() {
      try {
        const target = targetSchema.parse(JSON.parse(decodeURIComponent(subPath)));
        const { terminalId: id } = await rpc.call('usage.login', codex ? { ...target, method } : target);
        if (!alive) return;
        setTerminalId(id);
        if (!await navigation.current.experimental_openTerminal({ terminalId: id }))
          throw new Error('BB could not show the sign-in terminal. Use Show terminal to try again.');
        if (!alive) return;
        setMessage(opencode ? 'Paste your Go API key into the terminal and press Enter.'
          : !codex ? `Complete ${name} sign-in in the terminal and browser.`
          : method === 'device' ? 'Open the link in the terminal on any device and enter the code.'
            : 'Complete Codex sign-in in the terminal and the browser on the account machine.');
        async function check() {
          try {
            const terminal = await sdk.terminals.get({ terminalId: id });
            if (!alive) return;
            if (terminal.status === 'exited') {
              if (terminal.exitCode !== 0) throw new Error('Sign-in did not finish. Check the terminal, then try again.');
              setMessage(opencode ? 'Key saved. Checking Go access…' : 'Signed in. Refreshing usage…');
              if (opencode) {
                setCanCheck(true);
                await refreshGoAccess(() => alive);
                return;
              }
              try {
                await rpc.call('usage.inspection', { refresh: true });
                if (alive) { setMessage('Signed in. Usage refreshed.'); openUsage(); }
              } catch {
                if (alive) setMessage('Signed in. Open Agent usage to retry the usage refresh.');
              }
              return;
            }
            if (terminal.status === 'disconnected') throw new Error('The sign-in machine disconnected. Reconnect it, then try again.');
            timer = setTimeout(() => { void check(); }, 1000);
          } catch (cause) {
            if (alive) setError(cause instanceof Error ? cause.message : 'Could not check sign-in.');
          }
        }
        void check();
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : 'Could not start sign-in.');
      }
    }
    void start();
    return () => { alive = false; generation.current++; clearTimeout(timer); };
  }, [subPath, attempt, rpc, sdk, name, codex, opencode, method, refreshGoAccess]);
  return <div className="au-login-page">
    {opencode && <div className="au-login-hint">
      <h2>Connect OpenCode Go</h2>
      <ol>
        <li>Open Console and select the workspace with your Go subscription.</li>
        <li>Open the account menu, then Account, then Personal API keys. Create a key.</li>
        <li>Paste the key into the terminal. BB checks Go access and refreshes usage.</li>
      </ol>
      <p>Keep the key in the terminal. Do not paste it into chat.</p>
      <a className="au-login-button" href="https://opencode.ai/auth" target="_blank" rel="noreferrer">Open OpenCode Console</a>
    </div>}
    <p role="status">{message}</p>
    {codex && method === 'device' && <p className="au-login-hint">
      Device codes need device code sign-in turned on in ChatGPT security settings.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="au-login-actions">
      {canCheck && <button type="button" className="au-login-button" disabled={checking}
        onClick={() => { const current = generation.current; void refreshGoAccess(() => generation.current === current); }}>Check Go access</button>}
      {terminalId && <button type="button" className="au-login-button" onClick={() => {
        void navigate.experimental_openTerminal({ terminalId }).then(shown => {
          if (!shown) setError('The terminal has exited or is unavailable. Try signing in again.');
        }).catch(() => setError('BB could not show the sign-in terminal.'));
      }}>Show terminal</button>}
      {error && <button type="button" className="au-login-button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      {codex && <button type="button" className="au-login-button"
        onClick={() => setMethod(value => value === 'device' ? 'browser' : 'device')}>
        {method === 'device' ? 'Use browser instead' : 'Use a device code instead'}</button>}
      <button type="button" className="au-login-button" onClick={openUsage}>Agent usage</button>
    </div>
  </div>;
}
