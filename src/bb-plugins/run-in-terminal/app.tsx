import { useCallback, useEffect, useState } from 'react';
import { definePluginApp, useBbNavigate, useRpc, type PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk/app';
import { commandsFrom } from './commands.ts';
import type { rpcContract } from './contracts.ts';
import './app.css';

export default definePluginApp(app => {
  const pasters = new Map<string, (text: string) => Promise<void>>();
  /**
   * BB only opens a terminal for components inside the thread view; app overlays
   * sit outside it. The header slot is inside, so this renders there per thread
   * and shows nothing but an error notice.
   */
  function Paster({ threadId }: PluginThreadHeaderActionProps) {
    const rpc = useRpc<typeof rpcContract>();
    const navigate = useBbNavigate();
    const [error, setError] = useState<string | null>(null);
    const paste = useCallback(async (text: string) => {
      setError(null);
      try {
        if (!text) throw new Error('Select commands, or use a message with a bash fence.');
        const { terminalId } = await rpc.call('paste', { threadId, text });
        if (!await navigate.experimental_openTerminal({ terminalId })) {
          throw new Error('BB could not show the Commands terminal.');
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }, [rpc, navigate, threadId]);
    useEffect(() => {
      pasters.set(threadId, paste);
      return () => { if (pasters.get(threadId) === paste) pasters.delete(threadId); };
    }, [paste, threadId]);
    useEffect(() => {
      if (!error) return;
      const timer = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(timer);
    }, [error]);
    return error ? <p role="alert" className="run-in-terminal-error">{error}</p> : null;
  }
  app.slots.experimental_threadHeaderAction({ id: 'paster', title: 'Run in terminal', component: Paster });
  app.slots.messageAction({
    id: 'run-in-terminal', title: 'Run in terminal', icon: 'SquareTerminal',
    run: async ({ threadId, message, selectedText }) => {
      await pasters.get(threadId)?.(commandsFrom(selectedText, message.text));
    },
  });
});
