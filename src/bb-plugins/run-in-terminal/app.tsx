import { useCallback, useEffect, useRef, useState } from 'react';
import { definePluginApp, useBbNavigate, useRpc, type PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk/app';
import { commandsFrom } from './commands.ts';
import type { rpcContract } from './contracts.ts';
import './app.css';

type Notice = { kind: 'pending' } | { kind: 'error'; message: string };
interface Paster {
  paste: (text: string) => Promise<void>;
  report: (message: string) => void;
}

export default definePluginApp(app => {
  const pasters = new Map<string, Paster>();
  /**
   * BB only opens a terminal for components inside the thread view; app overlays
   * sit outside it. The header slot is inside, so this renders there per thread
   * and shows nothing but a pending or error notice.
   */
  function Paster({ threadId }: PluginThreadHeaderActionProps) {
    const rpc = useRpc<typeof rpcContract>();
    const navigate = useBbNavigate();
    const [notice, setNotice] = useState<Notice | null>(null);
    const busy = useRef(false);
    const report = useCallback((message: string) => setNotice({ kind: 'error', message }), []);
    const paste = useCallback(async (text: string) => {
      // A second paste while one is in flight lands the same commands twice in the terminal buffer.
      if (busy.current) return;
      if (!text) return report('Select commands, or use a message with a bash fence.');
      busy.current = true;
      setNotice({ kind: 'pending' });
      try {
        const { terminalId } = await rpc.call('paste', { threadId, text });
        if (!await navigate.experimental_openTerminal({ terminalId })) {
          throw new Error('BB could not show the Commands terminal.');
        }
        setNotice(null);
      } catch (cause) {
        report(cause instanceof Error ? cause.message : String(cause));
      } finally {
        busy.current = false;
      }
    }, [rpc, navigate, threadId, report]);
    useEffect(() => {
      const paster = { paste, report };
      pasters.set(threadId, paster);
      return () => { if (pasters.get(threadId) === paster) pasters.delete(threadId); };
    }, [paste, report, threadId]);
    useEffect(() => {
      if (notice?.kind !== 'error') return;
      const timer = setTimeout(() => setNotice(null), 6000);
      return () => clearTimeout(timer);
    }, [notice]);
    if (!notice) return null;
    if (notice.kind === 'pending') {
      return <p role="status" className="run-in-terminal-notice run-in-terminal-pending">Pasting into the Commands terminal…</p>;
    }
    return (
      <div className="run-in-terminal-notice">
        <p role="alert" className="run-in-terminal-error">{notice.message}</p>
        <button type="button" className="run-in-terminal-dismiss" aria-label="Dismiss" title="Dismiss" onClick={() => setNotice(null)}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    );
  }
  app.slots.experimental_threadHeaderAction({ id: 'paster', title: 'Run in terminal', component: Paster });
  app.slots.messageAction({
    id: 'run-in-terminal', title: 'Run in terminal', icon: 'SquareTerminal',
    run: async ({ threadId, message, selectedText }) => {
      const paster = pasters.get(threadId);
      if (paster) return paster.paste(commandsFrom(selectedText, message.text));
      // The terminal opens only from the thread's own view, e.g. not from a thread embedded in a panel.
      pasters.values().next().value?.report('Open this thread to paste its commands into its terminal.');
    },
  });
});
