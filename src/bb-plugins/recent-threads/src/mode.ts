import {
  lifecyclesSchema,
  restoreModeSchema,
  type Lifecycles,
  type OrganizationMode,
  type RestoreMode,
} from '../contracts.ts';

export const DEFAULT_RESTORE_MODE: RestoreMode = 'project';
export const DEFAULT_RESTORE_LIFECYCLES: Lifecycles = ['active'];

export function parseRestoreMode(value: unknown): RestoreMode {
  const parsed = restoreModeSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_RESTORE_MODE;
}

export function parseRestoreLifecycles(value: unknown): Lifecycles {
  const parsed = lifecyclesSchema.safeParse(value);
  return parsed.success && !isArchivedOnly(parsed.data) ? parsed.data : DEFAULT_RESTORE_LIFECYCLES;
}

export function isRecentMode(mode: OrganizationMode): boolean {
  return mode === 'chronological';
}

export function isArchivedOnly(lifecycles: Lifecycles): boolean {
  return lifecycles.length === 1 && lifecycles[0] === 'archived';
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

// Archived-only is the "on" state. Any filter that also shows active threads
// (Active, or Active + Archived) is remembered and restored on the way back.
export function nextArchivedToggle(
  current: Lifecycles,
  storedRestore: Lifecycles,
): { nextLifecycles: Lifecycles; restoreLifecycles: Lifecycles } {
  if (isArchivedOnly(current)) {
    return { nextLifecycles: storedRestore, restoreLifecycles: storedRestore };
  }
  return { nextLifecycles: ['archived'], restoreLifecycles: current };
}
