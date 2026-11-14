import type { ComponentType } from 'react';

// BB 0.48 retired `experimental_threadHeaderAction` from the SDK types but still renders it, and its
// replacement, a header thread action, draws only a text button. Chips stay on the retired slot until a
// header action can draw a toned badge (get-bb/bb#7217) or BB removes the slot.
export type ThreadHeaderChipProps = { threadId: string; projectId: string; isCompactViewport: boolean };
export type ThreadHeaderChip = { id: string; title: string; component: ComponentType<ThreadHeaderChipProps> };

export function registerThreadHeaderChip(app: { slots: object }, chip: ThreadHeaderChip) {
  (app.slots as { experimental_threadHeaderAction(value: ThreadHeaderChip): void }).experimental_threadHeaderAction(chip);
}
