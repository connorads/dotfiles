import { useEffect } from 'react';
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders as useProviders, useComposer } from '@get-bb/plugin-sdk/app';
import type { PluginThreadHeaderActionProps } from '@get-bb/plugin-sdk';
import { Chip, ChipValue } from '@bb-plugins/chip';
import type { ResolvedView } from './contracts.ts';
import { loadDraft, loadThread, setDraftProject, sourceLabel, toggle, useConnectors, type Target } from './store.ts';

/** BB's own Claude Code mark, so the chip matches the provider picker. */
function ClaudeMark() {
  const { providers } = useProviders();
  const claude = providers.find(p => p.id === 'claude-code') ?? { id: 'claude-code' };
  return <ProviderIcon providerKind="agent" provider={claude} fallback="Puzzle" aria-hidden />;
}

function describe(resolved: ResolvedView | undefined) {
  if (!resolved) return { value: '…', label: 'Claude connectors: loading' };
  if (!resolved.profile) return { value: 'Off', label: `Claude connectors are off (${sourceLabel(resolved.source)})` };
  return { value: resolved.profile, label: `Claude connectors: ${resolved.profile} (${sourceLabel(resolved.source)})` };
}

function ConnectorsChip({ target, resolved, compact }: { target: Target; resolved: ResolvedView | undefined; compact: boolean }) {
  const { open } = useConnectors();
  const { value, label } = describe(resolved);
  const isOpen = open !== null && JSON.stringify(open.target) === JSON.stringify(target);
  return <Chip data-cc-chip expanded={isOpen} aria-label={label} title={`${label} (⌥K)`}
    onClick={event => toggle(target, event.detail === 0 ? 'keyboard' : 'pointer', event.currentTarget)}
    icon={<ClaudeMark />}>
    {!compact && <ChipValue className={resolved && !resolved.profile ? 'cc-off' : undefined}>
      {resolved && resolved.source !== 'thread' && resolved.profile ? <>{value}<span className="cc-inherited"> · {resolved.source}</span></> : value}
    </ChipValue>}
  </Chip>;
}

export function HeaderChip({ threadId, projectId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const { threads } = useConnectors();
  useEffect(() => { void loadThread(threadId, projectId); }, [threadId, projectId]);
  return <ConnectorsChip target={{ kind: 'thread', threadId, projectId }} resolved={threads.get(threadId)?.resolved} compact={isCompactViewport} />;
}

/** The new-thread composer: the pick is saved per project and applied when the thread's first message dispatches. */
export function DraftChip() {
  const composer = useComposer();
  const projectId = composer.selection?.projectId ?? null;
  const { drafts } = useConnectors();
  useEffect(() => {
    setDraftProject(projectId);
    if (projectId) void loadDraft(projectId);
    return () => setDraftProject(null);
  }, [projectId]);
  if (!projectId) return null;
  return <ConnectorsChip target={{ kind: 'draft', projectId }} resolved={drafts.get(projectId)?.resolved} compact={false} />;
}
