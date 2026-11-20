import { restoreModeSchema, type OrganizationMode, type RestoreMode } from '../contracts.ts';

export const DEFAULT_RESTORE_MODE: RestoreMode = 'project';

export function parseRestoreMode(value: unknown): RestoreMode {
  const parsed = restoreModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_RESTORE_MODE;
}

export function isRecentMode(mode: OrganizationMode): boolean {
  return mode === 'chronological';
}

export function nextToggle(
  current: OrganizationMode,
  storedRestore: RestoreMode,
): { nextMode: OrganizationMode; restoreMode: RestoreMode } {
  if (current === 'chronological') {
    return { nextMode: storedRestore, restoreMode: storedRestore };
  }
  return { nextMode: 'chronological', restoreMode: current };
}
