import type { Favourite } from './contract.ts';

export type Skipped = { id: string; reason: 'already imported' | 'model already a favourite' | 'no free slot' };

export function mergeLegacy(existing: readonly Favourite[], legacy: readonly Favourite[]) {
  const list = [...existing];
  const skipped: Skipped[] = [];
  let imported = 0;
  for (const favourite of [...legacy].sort((a, b) => a.slot - b.slot)) {
    const free = Array.from({ length: 9 }, (_, i) => i + 1).filter(slot => !list.some(f => f.slot === slot));
    if (list.some(f => f.id === favourite.id)) skipped.push({ id: favourite.id, reason: 'already imported' });
    else if (list.some(f => f.providerId === favourite.providerId && f.model === favourite.model)) {
      skipped.push({ id: favourite.id, reason: 'model already a favourite' });
    } else if (!free.length) skipped.push({ id: favourite.id, reason: 'no free slot' });
    else {
      list.push({ ...favourite, slot: free.includes(favourite.slot) ? favourite.slot : free[0]! });
      imported++;
    }
  }
  return { list, imported, skipped };
}
