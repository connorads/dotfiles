export type TaskDate =
  | { kind: 'none'; label: string }
  | { kind: 'event'; label: string }
  | {
      kind: 'due' | 'before' | 'available' | 'week';
      value: string;
      label: string;
    };
export type Task = {
  id: string;
  title: string;
  raw: string;
  path: string;
  line: number;
  section: string;
  area: string;
  state: 'next' | 'doing' | 'waiting' | 'triage';
  date: TaskDate;
  links: { label: string; url: string; path: string | null }[];
};
export const agendaGroups = [
  'Past dates',
  'Today',
  'Next 7 days',
  'Available',
  'Waiting',
  'After an event',
  'Undated',
  'Later',
  'Dates to clarify',
  'Triage',
] as const;
export type AgendaGroup = (typeof agendaGroups)[number];
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T12:00:00Z');
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
export function relativeMarkdownPath(
  source: string,
  url: string,
): string | null {
  let path: string;
  try {
    path = decodeURIComponent(url.split('#')[0] ?? '');
  } catch {
    return null;
  }
  if (
    !path ||
    /^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path) ||
    /[\\?]/.test(path) ||
    !/\.md$/i.test(path)
  )
    return null;
  for (const char of path) {
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) return null;
  }
  const parts = source.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part !== '.' && part !== '') {
      if (part.startsWith('.')) return null;
      parts.push(part);
    }
  }
  return parts.join('/');
}
// FNV-1a keeps task ids short and identical in the server and browser bundles.
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
function plain(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`*_]/g, '')
    .trim();
}
function dateOf(
  title: string,
  section: string,
): { date: TaskDate; title: string } {
  const match = /^(Before |After |By |w\/c )?(\d{4}-\d{2}-\d{2})\s*-\s*/.exec(
    title,
  );
  if (match && match[2] && validDate(match[2])) {
    const prefix = (match[1] ?? '').trim();
    const kind =
      prefix === 'After'
        ? 'available'
        : prefix === 'Before'
          ? 'before'
          : prefix === 'w/c'
            ? 'week'
            : 'due';
    return {
      date: { kind, value: match[2], label: `${prefix} ${match[2]}`.trim() },
      title: title.slice(match[0].length),
    };
  }
  const event = /^(After [^-]+|Next [^-]+)\s*-\s*/.exec(title);
  if (event)
    return {
      date: { kind: 'event', label: event[1]?.trim() ?? '' },
      title: title.slice(event[0].length),
    };
  const heading = /^Before (\d{4}-\d{2}-\d{2})$/.exec(section);
  if (heading?.[1] && validDate(heading[1]))
    return {
      date: { kind: 'before', value: heading[1], label: section },
      title,
    };
  return { date: { kind: 'none', label: 'No date' }, title };
}
export function parseTasks(
  markdown: string,
  path: string,
): { tasks: Task[]; reviewed: string | null } {
  const tasks: Task[] = [];
  let section = '';
  let fence: { char: string; length: number } | null = null;
  let last: Task | undefined;
  const seen = new Map<string, number>();
  const reviewed =
    /Last reviewed:\s*(\d{4}-\d{2}-\d{2})/.exec(markdown)?.[1] ?? null;
  markdown.split(/\r?\n/).forEach((line, index) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = { char: marker[0] ?? '', length: marker.length };
      else if (marker[0] === fence.char && marker.length >= fence.length)
        fence = null;
      last = undefined;
      return;
    }
    if (fence) return;
    const heading = /^#{1,6}\s+(.+)/.exec(line);
    if (heading) {
      section = heading[1]?.trim() ?? '';
      last = undefined;
      return;
    }
    const match = /^(?:[-*+] |\d+\. )(?:\[([ xX])\]\s+)?(.+)/.exec(line);
    if (!match) {
      if (last && /^\s+\S/.test(line)) last.raw += '\n' + line;
      else if (line.trim()) last = undefined;
      return;
    }
    last = undefined;
    if (
      match[1]?.toLowerCase() === 'x' ||
      /^(done|completed|archive|archived)$/i.test(section)
    )
      return;
    if (!match[1] && (!section || /^(todo|tasks)$/i.test(section))) return;
    const raw = match[2] ?? '';
    const links: Task['links'] = [];
    for (const link of raw.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
      const url = link[2] ?? '';
      links.push({
        label: plain(link[1] ?? ''),
        url,
        path: relativeMarkdownPath(path, url),
      });
    }
    const parsed = dateOf(plain(raw), section);
    const prefix = /^([^:]{1,45}):\s*/.exec(parsed.title);
    const engagement = links
      .map((link) => link.path?.match(/^engagements\/([^/]+)/)?.[1])
      .find(Boolean);
    const area =
      prefix?.[1] ??
      (engagement
        ? engagement.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : 'Company');
    let title = prefix ? parsed.title.slice(prefix[0].length) : parsed.title;
    // Context belongs in the detail pane, rather than repeating source names on every card.
    const trailing = /\s+-\s+(?:\[[^\]]+\]\([^)]+\)(?:,?\s*)?)+$/.exec(raw);
    if (trailing) {
      const shorter = dateOf(
        plain(raw.slice(0, trailing.index)),
        section,
      ).title;
      title = shorter.replace(/^([^:]{1,45}):\s*/, '');
    }
    const state: Task['state'] =
      /waiting/i.test(section) ||
      /blocked on/i.test(raw) ||
      parsed.date.kind === 'event'
        ? 'waiting'
        : /triage|inbox/i.test(section)
          ? 'triage'
          : /doing|in progress/i.test(section)
            ? 'doing'
            : 'next';
    // Ids follow content, not line numbers, so edits elsewhere in the file keep an open task selected.
    const key = hash(`${section}\n${raw}`);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    last = {
      id: `${path}:${key}:${occurrence}`,
      path,
      line: index + 1,
      raw,
      title,
      section,
      area,
      state,
      date: parsed.date,
      links,
    };
    tasks.push(last);
  });
  return { tasks, reviewed: reviewed && validDate(reviewed) ? reviewed : null };
}
export function agendaGroup(task: Task, today: string): AgendaGroup {
  if (task.state === 'triage') return 'Triage';
  const date = task.date;
  if (date.kind === 'event') return 'After an event';
  if (date.kind === 'week') return 'Dates to clarify';
  if (date.kind === 'available')
    return date.value <= today ? 'Available' : 'Later';
  if (date.kind === 'none')
    return task.state === 'waiting' ? 'Waiting' : 'Undated';
  if (date.value < today) return 'Past dates';
  if (date.value === today) return 'Today';
  const days =
    (Date.parse(date.value + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) /
    86400000;
  return days <= 7 ? 'Next 7 days' : 'Later';
}
export function dateKey(task: Task): string {
  return 'value' in task.date ? task.date.value : '9999';
}
export function localToday(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}
