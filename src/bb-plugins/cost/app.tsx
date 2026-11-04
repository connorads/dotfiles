import { useCallback, useEffect, useState } from 'react';
import { definePluginApp, experimental_Icon as Icon, useBbNavigate, useRealtime, useRpc } from '@get-bb/plugin-sdk/app';
import { Chip, ChipValue } from '@bb-plugins/chip';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import type { rpcContract, ThreadView } from './contracts.ts';
import { shortModel, tokens, usd } from './src/format.ts';
import { UsagePage } from './page.tsx';
import './app.css';

export function describeThread(view: ThreadView): string {
  const lines = [`${usd(view.usd)} at API prices, ${view.requests} requests`];
  const { parts } = view;
  lines.push(`Cache read ${usd(parts.cacheRead)} · cache write ${usd(parts.cacheWrite)} · output ${usd(parts.output)} · input ${usd(parts.input)}`);
  for (const model of view.models.slice(0, 4))
    lines.push(`${shortModel(model.model)}: ${model.priced ? usd(model.usd) : 'no price'} (${tokens(model.tokens.input + model.tokens.cacheRead + model.tokens.cacheWrite + model.tokens.output)} tokens)`);
  return lines.join('\n');
}

function CostChip({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [view, setView] = useState<ThreadView | null>(null);
  const load = useCallback(() => { rpc.call('thread', { threadId }).then(setView, () => setView(null)); }, [rpc, threadId]);
  useEffect(() => { setView(null); load(); }, [load]);
  useRealtime('usage-changed', load);
  if (!view) return null;
  const summary = describeThread(view);
  return <Chip className="cost-chip" icon={<Icon name="cost/coins" />} aria-label={`Thread cost. ${summary}`} title={summary}
    onClick={() => navigate.toPluginPanel('usage', { subPath: `thread/${threadId}` })}>
    {!isCompactViewport && <ChipValue>{usd(view.usd)}</ChipValue>}
  </Chip>;
}

export default definePluginApp(app => {
  app.slots.experimental_threadHeaderAction({ id: 'cost', title: 'Thread cost', component: CostChip });
  app.slots.navPanel({ id: 'usage', title: 'Usage', icon: 'cost/coins', path: 'usage', component: UsagePage });
});
