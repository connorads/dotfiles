import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, useBbNavigate, useRpc } from '@get-bb/plugin-sdk/app';
import type { rpcContract } from './contracts.ts';
import './app.css';

/** Git Glance's `l` key dispatches this with the thread to open. */
const openEvent = 'lazygit:open';
/** An open that takes longer than this shows an opening status. */
const slowOpenMs = 800;
/** An unheld error notice clears after this. */
const errorMs = 6000;

export default definePluginApp(app => {
  let opener: ((threadId: string) => Promise<void>) | null = null;
  /** Holds the hooks the shortcut and event need; renders only an opening status or an error notice. */
  function Opener() {
    const rpc = useRpc<typeof rpcContract>();
    const navigate = useBbNavigate();
    const [error, setError] = useState<string | null>(null);
    /** Pointer or focus is on the notice, so its timer waits. */
    const [held, setHeld] = useState(false);
    const [busy, setBusy] = useState(false);
    const [slow, setSlow] = useState(false);
    /** The latest open owns the terminal focus and the notice; earlier opens finish silently. */
    const latest = useRef(0);
    const clear = useCallback(() => { setError(null); setHeld(false); }, []);
    const open = useCallback(async (threadId: string, cwd?: string) => {
      const id = ++latest.current;
      clear();
      setBusy(true);
      try {
        if (!('experimental_openTerminal' in navigate) || typeof navigate.experimental_openTerminal !== 'function') {
          throw new Error('Open lazygit requires BB 0.46 or later.');
        }
        const { terminalId } = await rpc.call('open', { threadId, ...cwd === undefined ? {} : { cwd } });
        if (id !== latest.current) return;
        if (!await navigate.experimental_openTerminal({ terminalId })) {
          throw new Error('BB could not show the lazygit terminal.');
        }
      } catch (cause) {
        if (id === latest.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (id === latest.current) setBusy(false);
      }
    }, [rpc, navigate, clear]);
    useEffect(() => {
      opener = open;
      const onOpen = (event: Event) => {
        const detail = (event as CustomEvent<{ threadId?: unknown; cwd?: unknown }>).detail;
        if (typeof detail?.threadId === 'string' && (detail.cwd === undefined || typeof detail.cwd === 'string')) void open(detail.threadId, detail.cwd);
      };
      window.addEventListener(openEvent, onOpen);
      return () => { window.removeEventListener(openEvent, onOpen); if (opener === open) opener = null; };
    }, [open]);
    useEffect(() => {
      if (!busy) { setSlow(false); return; }
      const timer = setTimeout(() => setSlow(true), slowOpenMs);
      return () => clearTimeout(timer);
    }, [busy]);
    useEffect(() => {
      if (!error || held) return;
      const timer = setTimeout(clear, errorMs);
      return () => clearTimeout(timer);
    }, [error, held, clear]);
    if (error) {
      return (
        <div
          role="alert" className="lazygit-notice lazygit-error"
          onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}
        >
          <p><strong>Could not open lazygit</strong><br />{error}</p>
          <button type="button" className="lazygit-dismiss" aria-label="Dismiss" onClick={clear}>×</button>
        </div>
      );
    }
    return slow ? <p role="status" className="lazygit-notice">Opening lazygit…</p> : null;
  }
  app.slots.experimental_appOverlay({ id: 'opener', component: Opener });
  app.commands.register({
    id: 'open', title: 'Open lazygit', defaultShortcut: { key: 'g', mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null && opener !== null,
    run: async ({ threadId }) => { if (threadId) await opener?.(threadId); },
  });
});
