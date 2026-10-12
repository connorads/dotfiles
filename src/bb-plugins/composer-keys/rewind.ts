// A user prompt that bb can rewind to. `seq` is the event sequence of its
// `client/turn/requested` event, which editMessage and fork take as their anchor.
export interface Prompt {
  seq: number;
  text: string;
  input: readonly InputItem[];
}

export type InputItem = { type: string; text?: string; [key: string]: unknown };

interface EventRow {
  seq: number | string;
  type: string;
  data: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export function promptsFromEvents(rows: readonly EventRow[]): Prompt[] {
  return rows.flatMap(row => {
    if (row.type !== 'client/turn/requested' || !isRecord(row.data) || row.data.initiator !== 'user') return [];
    const input = Array.isArray(row.data.input) ? row.data.input.filter(isRecord) as InputItem[] : [];
    const text = input.flatMap(item => item.type === 'text' && typeof item.text === 'string' ? [item.text] : []).join('\n');
    return [{ seq: Number(row.seq), text, input }];
  }).sort((a, b) => a.seq - b.seq);
}

// Unchanged text keeps the original input, mentions included. Edited text drops the
// mentions, because their offsets point into the old text. Attachments survive either way.
export function editedInput(prompt: Prompt, text: string): InputItem[] {
  if (text === prompt.text) return [...prompt.input];
  return [{ type: 'text', text, mentions: [] }, ...prompt.input.filter(item => item.type !== 'text')];
}
