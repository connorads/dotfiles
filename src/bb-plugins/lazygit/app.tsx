import { useEffect, useState } from 'react';
import { definePluginApp, useBbNavigate, useComposer, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import { composerTarget, type LazygitTarget } from './open.ts';
import './app.css';

/** Git Glance's `l` key dispatches this with the thread to open. */
const openEvent = 'lazygit:open';

export default definePluginApp(app => {
  /**
   * Openers keyed by composer. Only a component inside a thread or New thread
   * screen gets a navigator that can show terminals; an app overlay cannot.
   */
  const openers = new Map<string, { target: LazygitTarget | null; open: () => Promise<void> }>();
  let showError: (message: string) => void = () => {};

  /** Mounted in each composer to lend the command its screen's terminal panel. Renders nothing. */
  function Anchor() {
    const composer = useComposer();
    const navigate = useBbNavigate();
    const rpc = useRpc<typeof rpcContract>();
    const target = composerTarget(composer.scope, composer.selection);
    useEffect(() => {
      const open = async () => {
        if (!target) throw new Error('Pick a project to open lazygit.');
        if (!('experimental_openTerminal' in navigate) || typeof navigate.experimental_openTerminal !== 'function') {
          throw new Error('Open lazygit requires BB 0.46 or later.');
        }
        const { terminalId } = await rpc.call('open', target);
        if (!await navigate.experimental_openTerminal({ terminalId })) {
          throw new Error('BB could not show the lazygit terminal.');
        }
      };
      const entry = { target, open };
      openers.set(composer.key, entry);
      return () => { if (openers.get(composer.key) === entry) openers.delete(composer.key); };
    }, [composer.key, JSON.stringify(target), navigate, rpc]);
    return null;
  }

  async function run(key: string | undefined) {
    try {
      const opener = key === undefined ? undefined : openers.get(key);
      if (!opener) throw new Error('Open lazygit from a thread or the New thread screen.');
      await opener.open();
    } catch (cause) {
      showError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /** Shows launch failures; listens for Git Glance's open event. */
  function Notice() {
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
      showError = setError;
      const onOpen = (event: Event) => {
        const threadId = (event as CustomEvent<{ threadId?: unknown }>).detail?.threadId;
        const match = [...openers].find(([, o]) => o.target?.kind === 'thread' && o.target.threadId === threadId);
        void run(match?.[0]);
      };
      window.addEventListener(openEvent, onOpen);
      return () => { window.removeEventListener(openEvent, onOpen); showError = () => {}; };
    }, []);
    useEffect(() => {
      if (!error) return;
      const timer = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(timer);
    }, [error]);
    return error ? <p role="alert" className="lazygit-error">{error}</p> : null;
  }

  app.slots.experimental_appOverlay({ id: 'notice', component: Notice });
  app.composer.customize({ id: 'lazygit', scopes: ['thread', 'new-thread'], actions: [{ id: 'anchor', component: Anchor }] });
  app.composer.experimental_registerCommand({
    id: 'open', title: 'Open lazygit', defaultShortcut: { key: 'g', mod: true, shift: true },
    run: ({ composer }) => run(composer.key),
  });
});
