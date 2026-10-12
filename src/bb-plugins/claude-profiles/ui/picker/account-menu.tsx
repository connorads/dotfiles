import { useId, useRef, useState } from 'react';
import { experimental_Icon as Icon, useRpc } from '@get-bb/plugin-sdk/app';
import type { Profile, rpcContract } from '../../contracts.ts';
import type { Usage } from '../../src/accounts/quota.ts';
import { ListPopover } from './popover.tsx';

const SHORT: Record<string, string> = { five_hour: '5h', seven_day: '7d' };

function quota(usage: Usage): string | null {
  const parts = usage.status === 'ok' ? usage.windows.filter(window => SHORT[window.id])
    .map(window => `${SHORT[window.id]} ${Math.round(window.usedPercent)}%`) : [];
  return parts.length ? parts.join(' · ') : null;
}

/**
 * The Claude account as a menu button. Accounts show their quota once the menu opens, read through
 * the server's one-minute quota cache; a draft reads on the machine that lists its accounts.
 */
export function AccountMenu({ threadId, profiles, currentId, disabled, buttonRef, onChoose }: {
  threadId: string | null; profiles: readonly Profile[]; currentId: string; disabled: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>; onChoose: (profileId: string) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [quotas, setQuotas] = useState<Record<string, string | null>>({});
  const requested = useRef(new Set<string>());
  function show() {
    setOpen(value => !value);
    for (const profile of profiles) {
      if (requested.current.has(profile.id)) continue;
      requested.current.add(profile.id);
      const reading = threadId === null ? rpc.call('nextThreadQuota', { profileId: profile.id })
        : rpc.call('usage', { threadId, profileId: profile.id, refresh: false });
      reading.then(
        usage => setQuotas(previous => ({ ...previous, [profile.id]: quota(usage) })),
        () => setQuotas(previous => ({ ...previous, [profile.id]: null })));
    }
  }
  const label = profiles.find(profile => profile.id === currentId)?.label ?? 'Default';
  return <>
    <span id={`${id}-label`} className="mf-now-label">Claude account</span>
    <button ref={buttonRef} type="button" className="mf-account-button" disabled={disabled}
      aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} onClick={show}>
      <span className="mf-account-dot" aria-hidden="true" /><span id={`${id}-value`}>{label}</span>
      <Icon name="ChevronDown" className="mf-account-chevron" />
    </button>
    {open && <ListPopover anchor={buttonRef} label="Claude accounts" value={currentId}
      choices={profiles.map(profile => ({ value: profile.id, label: profile.label,
        detail: <span className="mf-quota">{quotas[profile.id] ?? ''}</span> }))}
      onSelect={profileId => { if (profileId !== currentId) onChoose(profileId); }} onClose={() => setOpen(false)} />}
  </>;
}
