// Live-call grabs and the composer mentions that carry transcripts to an agent.

/** `vox grab` windows: a count with an optional s / m / h unit (bare = minutes). */
export const isWindow = (window: string) => /^\d+[smh]?$/.test(window);

/**
 * Spoken words only: past the one-line context header and its blank line,
 * without each line's `[hh:mm:ss] Speaker:` prefix (as vox-grab.sh counts).
 */
export function countWords(markdown: string): number {
  return markdown.split('\n').slice(2)
    .map(line => line.replace(/^\[[^\]]*\] [^:]*: /, ''))
    .join(' ').split(/\s+/).filter(Boolean).length;
}

export function grabLabel(window: string | null, words: number): string {
  const span = window ? `Last ${window} of call` : 'Call so far';
  return `${span} · ${words} word${words === 1 ? '' : 's'}`;
}

const grabIdPattern = /^grab-\d{8}-\d{6}-[a-z0-9]{6}$/;
export const isGrabId = (id: string) => grabIdPattern.test(id);

export function grabId(now: Date, random: () => number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(random() * 36)]).join('');
  return `grab-${stamp}-${suffix}`;
}

/** Mention item ids are `rec:<recording name>` or `grab:<grab id>`. */
export type MentionTarget = { kind: 'recording'; name: string } | { kind: 'grab'; id: string };

export function parseMentionId(id: string, isRecordingName: (name: string) => boolean): MentionTarget | null {
  const colon = id.indexOf(':');
  if (colon < 0) return null;
  const prefix = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  if (prefix === 'rec' && isRecordingName(rest)) return { kind: 'recording', name: rest };
  if (prefix === 'grab' && isGrabId(rest)) return { kind: 'grab', id: rest };
  return null;
}

/** The agent-visible context a mention resolves to. The pill shows the user only the label. */
export function mentionContext(source: string, path: string, text: string): string {
  return `${source}. Saved at ${path}.\n\n${text.trim()}\n`;
}
