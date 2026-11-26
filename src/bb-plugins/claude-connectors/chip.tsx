import { useEffect } from 'react';
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders as useProviders, useComposer } from '@get-bb/plugin-sdk/app';
import type { ThreadHeaderChipProps } from '@bb-plugins/chip/header';
import { Chip, ChipDot, ChipValue } from '@bb-plugins/chip';
import type { ResolvedView } from './contracts.ts';
import { loadConnectors, loadDraft, loadKey, loadThread, setDraftProject, sourceLabel, toggle, useConnectors, type Target } from './store.ts';

/** BB's own Claude Code mark, so the chip matches the provider picker. */
function ClaudeMark() {
  const { providers } = useProviders();
  const claude = providers.find(p => p.id === 'claude-code') ?? { id: 'claude-code' };
  return <ProviderIcon providerKind="agent" provider={claude} fallback="Puzzle" aria-hidden />;
}

function describe(resolved: ResolvedView | undefined, error: string | undefined, kind: Target['kind']) {
  if (!resolved && error) return { value: 'Not loaded', label: `Claude connectors: could not load the choice. ${error}` };
  if (!resolved) return { value: '…', label: 'Claude connectors: loading' };
  if (!resolved.profile) return { value: 'Off', label: `Claude connectors are off (${sourceLabel(resolved.source, kind)})` };
  return { value: resolved.profile, label: `Claude connectors: ${resolved.profile} (${sourceLabel(resolved.source, kind)})` };
}

function suffixFor(resolved: ResolvedView | undefined): string | null {
  if (!resolved || !resolved.profile) return null;
  if (resolved.readOnly) return 'read-only';
  if (resolved.source !== 'thread') return resolved.source;
  return null;
}

function ConnectorsChip({ target, resolved, compact }: { target: Target; resolved: ResolvedView | undefined; compact: boolean }) {
  const { open, loadErrors, saves, connectors } = useConnectors();
  const error = loadErrors.get(loadKey(target))?.error;
  const saveError = saves.get(loadKey(target))?.error;
  const profile = resolved?.profile ?? null;
  // The thread gets no connector tools when its profile cannot list them, so the chip warns.
  useEffect(() => { if (profile) void loadConnectors(profile); }, [profile]);
  const list = profile ? connectors.get(profile) : undefined;
  const unavailable = list && list !== 'loading' ? list.error : null;
  const described = describe(resolved, error, target.kind);
  const label = [described.label, unavailable && `Its connectors are not available. ${unavailable}`, saveError && `The last change was not saved. ${saveError}`]
    .filter(Boolean).join('. ');
  const warn = (!resolved && error) || saveError || unavailable;
  const isOpen = open !== null && JSON.stringify(open.target) === JSON.stringify(target);
  const suffix = suffixFor(resolved);
  // The dot keeps a warning visible when a narrow header hides the value.
  return <Chip data-cc-chip expanded={isOpen} aria-label={label} title={`${label} (⌥⇧E)`} tone={warn ? 'warn' : undefined}
    onClick={event => toggle(target, event.detail === 0 ? 'keyboard' : 'pointer', event.currentTarget)}
    icon={<ClaudeMark />}>
    {!compact && <ChipValue className={resolved && !resolved.profile ? 'cc-off' : undefined}>
      {suffix ? <>{described.value}<span className="cc-inherited"> · {suffix}</span></> : described.value}
    </ChipValue>}
    {warn && <ChipDot tone="warn" />}
  </Chip>;
}

export function HeaderChip({ threadId, projectId, isCompactViewport }: ThreadHeaderChipProps) {
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
