import { useCallback, useEffect, useState } from 'react';
import { definePluginApp, experimental_Icon as Icon, useBbNavigate, useRpc } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract } from './contracts.ts';
import './app.css';

export default definePluginApp(app => {
  const openers = new Map<string, () => Promise<void>>();
  function LazygitButton({ threadId }: PluginThreadHeaderActionProps) {
    const rpc = useRpc<typeof rpcContract>();
    const navigate = useBbNavigate();
    const [error, setError] = useState<string | null>(null);
    const open = useCallback(async () => {
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
    }, [rpc, navigate, threadId]);
    useEffect(() => {
      openers.set(threadId, open);
      return () => { if (openers.get(threadId) === open) openers.delete(threadId); };
    }, [threadId, open]);
    return <span>
      <button type="button" className="lazygit-button" onClick={open}
        aria-label="Open lazygit" title="Open lazygit (Cmd+Shift+G)"><Icon name="GitBranch" className="size-4" /></button>
      {error && <span role="alert" className="text-sm text-destructive">{error}</span>}
    </span>;
  }
  app.slots.experimental_threadHeaderAction({ id: 'open', title: 'Open lazygit', component: LazygitButton });
  app.commands.register({
    id: 'open', title: 'Open lazygit', defaultShortcut: { key: 'g', mod: true, shift: true },
    isAvailable: ({ threadId }) => threadId !== null && openers.has(threadId),
    run: async ({ threadId }) => { if (threadId) await openers.get(threadId)?.(); },
  });
});
