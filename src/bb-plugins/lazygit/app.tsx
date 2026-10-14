import { useCallback, useEffect, useState } from 'react';
import { definePluginApp, useBbNavigate, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import './app.css';

/** Git Glance's `l` key dispatches this with the thread to open. */
const openEvent = 'lazygit:open';

export default definePluginApp(app => {
  let opener: ((threadId: string) => Promise<void>) | null = null;
  /** Holds the hooks the shortcut and event need; renders only an error notice. */
  function Opener() {
    const rpc = useRpc<typeof rpcContract>();
    const navigate = useBbNavigate();
    const [error, setError] = useState<string | null>(null);
    const open = useCallback(async (threadId: string) => {
      setError(null);
      try {
        if (!('experimental_openTerminal' in navigate) || typeof navigate.experimental_openTerminal !== 'function') {
          throw new Error('Open lazygit requires BB 0.46 or later.');
        }
        const { terminalId } = await rpc.call('open', { threadId });
        if (!await navigate.experimental_openTerminal({ terminalId })) {
          throw new Error('BB could not show the lazygit terminal.');
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }, [rpc, navigate]);
    useEffect(() => {
      opener = open;
      const onOpen = (event: Event) => {
        const threadId = (event as CustomEvent<{ threadId?: unknown }>).detail?.threadId;
        if (typeof threadId === 'string') void open(threadId);
      };
      window.addEventListener(openEvent, onOpen);
      return () => { window.removeEventListener(openEvent, onOpen); if (opener === open) opener = null; };
    }, [open]);
    useEffect(() => {
      if (!error) return;
      const timer = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(timer);
    }, [error]);
    return error ? <p role="alert" className="lazygit-error">{error}</p> : null;
  }
  app.slots.experimental_appOverlay({ id: 'opener', component: Opener });
  app.commands.register({
    id: 'open', title: 'Open lazygit', defaultShortcut: { key: 'g', mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null && opener !== null,
    run: async ({ threadId }) => { if (threadId) await opener?.(threadId); },
  });
});
