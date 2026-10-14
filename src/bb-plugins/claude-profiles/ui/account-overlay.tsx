import { useEffect, useSyncExternalStore } from 'react';
import { useComposers } from '@get-bb/plugin-sdk/app';
import { AccountPicker } from './picker/account-picker.tsx';
import { close, openedState, subscribe } from './picker/store.ts';

export function AccountOverlay() {
  const opened = useSyncExternalStore(subscribe, openedState);
  const composers = useComposers();
  const composer = composers.find(candidate => candidate.key === opened?.key);
  useEffect(() => { if (opened && !composer) close(); }, [opened, composer]);
  if (!composer) return null;
  return <AccountPicker key={composer.key} composer={composer} onClose={() => { close(); composer.focus(); }} />;
}
