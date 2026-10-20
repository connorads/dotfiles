import { useEffect, useRef, useState } from 'react';
import { useBbNavigate, useRpc, useSdk, type PluginNavPanelProps } from '@get-bb/plugin-sdk/app';
import { z } from 'zod';
import type { rpcContract } from '../../contracts.ts';
import { openUsage } from './overlay-store.ts';

const targetSchema = z.object({ hostId: z.string(), accountId: z.string() });
const providerName = (subPath: string | undefined) => subPath?.includes('"provider-codex:') ? 'Codex' : 'Claude';

export function LoginPage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const [attempt, setAttempt] = useState(0);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const name = providerName(subPath);
  const [message, setMessage] = useState(`Opening ${name} sign-in…`);
  const [error, setError] = useState<string | null>(null);
  // Keep navigation from restarting the login when the terminal panel opens.
  const navigation = useRef(navigate);
  navigation.current = navigate;
  useEffect(() => {
    if (!subPath) { setMessage('Choose Sign in again beside an account in Agent usage.'); return; }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError(null);
    setTerminalId(null);
    setMessage(`Opening ${name} sign-in…`);
    async function start() {
      try {
        const target = targetSchema.parse(JSON.parse(decodeURIComponent(subPath)));
        const { terminalId: id } = await rpc.call('usage.login', target);
        if (!alive) return;
        setTerminalId(id);
        if (!await navigation.current.experimental_openTerminal({ terminalId: id }))
          throw new Error('BB could not show the sign-in terminal. Use Show terminal to try again.');
        if (!alive) return;
        setMessage(`Complete ${name} sign-in in the terminal and browser.`);
        async function check() {
          try {
            const terminal = await sdk.terminals.get({ terminalId: id });
            if (!alive) return;
            if (terminal.status === 'exited') {
              if (terminal.exitCode !== 0) throw new Error('Sign-in did not finish. Check the terminal, then try again.');
              setMessage('Signed in. Refreshing usage…');
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
    return () => { alive = false; clearTimeout(timer); };
  }, [subPath, attempt, rpc, sdk, name]);
  return <div className="au-login-page">
    <p role="status">{message}</p>
    {error && <p role="alert">{error}</p>}
    <div className="au-login-actions">
      {terminalId && <button type="button" className="au-login-button" onClick={() => {
        void navigate.experimental_openTerminal({ terminalId }).then(shown => {
          if (!shown) setError('The terminal has exited or is unavailable. Try signing in again.');
        }).catch(() => setError('BB could not show the sign-in terminal.'));
      }}>Show terminal</button>}
      {error && <button type="button" className="au-login-button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}
      <button type="button" className="au-login-button" onClick={openUsage}>Agent usage</button>
    </div>
  </div>;
}
