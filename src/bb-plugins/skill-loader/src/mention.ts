// A pill's item id must carry everything `resolve` needs: bb calls
// `resolve(itemId)` at send time with no thread or host context. The host id
// says which machine's `skl` catalogue to read; the ref says what to load.

import type { Row } from './rows.ts';

export const MENTION_PROVIDER_ID = 'skl';

export type MentionTarget = { readonly hostId: string; readonly ref: string };

const separator = '|';

export function encodeMentionId(target: MentionTarget): string {
  if (target.hostId.includes(separator)) throw new Error(`Host id ${target.hostId} contains "${separator}".`);
  return `${target.hostId}${separator}${target.ref}`;
}

export function decodeMentionId(id: string): MentionTarget | null {
  const at = id.indexOf(separator);
  if (at <= 0 || at === id.length - 1) return null;
  return { hostId: id.slice(0, at), ref: id.slice(at + 1) };
}

export type Pill = { readonly provider: string; readonly id: string; readonly label: string };

/** One pill per selected row, space-separated, so stacked skills read like the tmux paste. */
export function pillParts(hostId: string, refs: readonly string[]): (Pill | string)[] {
  return refs.flatMap(ref => [
    { provider: MENTION_PROVIDER_ID, id: encodeMentionId({ hostId, ref }), label: ref },
    ' ',
  ]);
}

export type MentionItem = { readonly id: string; readonly title: string; readonly subtitle?: string };

/** Mention-menu rows for already-filtered rows, capped so the menu stays short. */
export function mentionItems(hostId: string, rows: readonly Row[], limit: number): MentionItem[] {
  return rows.slice(0, limit).map(row => {
    const id = encodeMentionId({ hostId, ref: row.ref });
    if (row.kind === 'folder') return { id, title: row.ref, subtitle: `${row.count} skill${row.count === 1 ? '' : 's'}` };
    const subtitle = row.description.length > 120 ? `${row.description.slice(0, 119)}…` : row.description;
    return subtitle ? { id, title: row.ref, subtitle } : { id, title: row.ref };
  });
}
