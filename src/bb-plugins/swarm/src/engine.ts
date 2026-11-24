import {
  concerns,
  coordinatorName,
  head,
  isClosed,
  isLive,
  parseMentions,
  type Author,
  type Entry,
  type EntryBody,
  type Member,
  type MemberName,
  type Seq,
  type Swarm,
  type ThreadId,
} from './domain.ts';

export type Input = { at: number } & (
  | { type: 'join'; by: MemberName; name: MemberName; threadId: ThreadId; brief: string }
  | { type: 'post'; author: MemberName | 'human'; text: string }
  | { type: 'close'; by: MemberName | 'human'; summary: string }
  | { type: 'turnStarted'; member: MemberName }
  | { type: 'turnEnded'; member: MemberName; lastReply: string | null }
  | { type: 'turnFailed'; member: MemberName; error: string }
  | { type: 'gone'; member: MemberName }
);

export type Effect =
  | { type: 'wake'; member: MemberName; threadId: ThreadId; entries: Entry[] }
  | { type: 'stop'; member: MemberName; threadId: ThreadId };

export type SwarmError =
  | { code: 'closed' }
  | { code: 'unknown-member'; name: string }
  | { code: 'not-coordinator'; by: MemberName }
  | { code: 'name-taken'; name: MemberName }
  | { code: 'member-limit'; maxMembers: number }
  | { code: 'empty-text' };

export type Decision = { ok: true; swarm: Swarm; effects: Effect[] } | { ok: false; error: SwarmError };

interface Draft {
  entries: Entry[];
  members: Member[];
  wakes: number;
  effects: Effect[];
}

/**
 * The whole swarm policy. Commands can be refused; lifecycle events never are,
 * and are ignored once the swarm is closed or when they repeat.
 */
export function decide(swarm: Swarm, input: Input): Decision {
  const draft: Draft = {
    entries: [...swarm.entries],
    members: swarm.members.map(member => ({ ...member })),
    wakes: swarm.wakes,
    effects: [],
  };
  const append = (body: EntryBody): Seq => {
    const seq = (draft.entries.length + 1) as Seq;
    draft.entries.push({ seq, at: input.at, ...body });
    return seq;
  };
  const find = (name: Author) => draft.members.find(member => member.name === name);
  const refused = (error: SwarmError): Decision => ({ ok: false, error });
  const unchanged: Decision = { ok: true, swarm, effects: [] };
  const closed = isClosed(swarm);

  switch (input.type) {
    case 'join': {
      if (closed) return refused({ code: 'closed' });
      if (find(input.by)?.role !== 'coordinator') return refused({ code: 'not-coordinator', by: input.by });
      if (find(input.name)) return refused({ code: 'name-taken', name: input.name });
      if (draft.members.filter(isLive).length >= swarm.limits.maxMembers) {
        return refused({ code: 'member-limit', maxMembers: swarm.limits.maxMembers });
      }
      // The brief is the worker's first prompt, so its cursor starts past it.
      const seq = append({ kind: 'joined', member: input.name, brief: input.brief });
      draft.members.push({ name: input.name, threadId: input.threadId, role: 'worker', run: 'working', cursor: seq, turnStart: seq });
      break;
    }
    case 'post': {
      if (closed) return refused({ code: 'closed' });
      if (input.author !== 'human' && !find(input.author)) return refused({ code: 'unknown-member', name: input.author });
      const text = input.text.trim();
      if (!text) return refused({ code: 'empty-text' });
      append({ kind: 'post', author: input.author, text, mentions: parseMentions(text, input.author, draft.members).known });
      break;
    }
    case 'close': {
      if (closed) return refused({ code: 'closed' });
      if (input.by !== 'human' && find(input.by)?.role !== 'coordinator') return refused({ code: 'not-coordinator', by: input.by });
      for (const member of draft.members) {
        if (member.role !== 'worker' || !isLive(member)) continue;
        member.run = 'stopped';
        draft.effects.push({ type: 'stop', member: member.name, threadId: member.threadId });
      }
      append({ kind: 'closed', summary: input.summary.trim() });
      break;
    }
    case 'turnStarted': {
      const member = find(input.member);
      if (closed || !member || member.run === 'working' || member.run === 'stopped') return unchanged;
      member.run = 'working';
      member.turnStart = head(draft);
      break;
    }
    case 'turnEnded': {
      const member = find(input.member);
      if (closed || !member || member.run !== 'working') return unchanged;
      member.run = 'idle';
      const posted = draft.entries.some(entry => entry.seq > member.turnStart && entry.kind === 'post' && entry.author === member.name);
      if (member.role === 'worker' && !posted) append({ kind: 'reply', member: member.name, text: input.lastReply?.trim() ?? '' });
      break;
    }
    case 'turnFailed': {
      const member = find(input.member);
      if (closed || !member || member.run !== 'working') return unchanged;
      member.run = 'failed';
      append({ kind: 'failed', member: member.name, error: input.error });
      break;
    }
    case 'gone': {
      const member = find(input.member);
      if (closed || !member || member.run === 'stopped') return unchanged;
      member.run = 'stopped';
      append({ kind: 'left', member: member.name });
      break;
    }
  }

  if (!isClosed(draft)) settle(draft, swarm.limits.maxWakes, append);
  const { effects, ...next } = draft;
  return { ok: true, swarm: { ...next, limits: swarm.limits }, effects };
}

function settle(draft: Draft, maxWakes: number, append: (body: EntryBody) => Seq): void {
  if (wakeIdle(draft, maxWakes, append)) return;
  const coordinator = draft.members.find(member => member.role === 'coordinator');
  const exhausted = draft.entries.some(entry => entry.kind === 'exhausted');
  if (exhausted || coordinator?.run !== 'idle' || draft.members.some(member => member.run === 'working')) return;
  // A stall: everyone is idle while posts sit on the board that never reached the coordinator.
  const unseen = draft.entries.filter(
    entry => entry.seq > coordinator.cursor && entry.kind === 'post' && entry.author !== coordinator.name && entry.author !== 'engine',
  );
  if (unseen.length === 0) return;
  const numbers = unseen.map(entry => `#${entry.seq}`).join(', ');
  append({
    kind: 'post',
    author: 'engine',
    text: `@${coordinatorName} Every member is idle. These posts did not mention you: ${numbers}. Read the board, then assign work, ask the human, or close the swarm.`,
    mentions: [coordinatorName],
  });
  wakeIdle(draft, maxWakes, append);
}

/** Sends each idle member its unread entries in one wake. Returns whether anything was due. */
function wakeIdle(draft: Draft, maxWakes: number, append: (body: EntryBody) => Seq): boolean {
  let due = false;
  for (const member of draft.members) {
    if (member.run !== 'idle') continue;
    const unread = draft.entries.filter(entry => entry.seq > member.cursor && concerns(entry, member));
    if (unread.length === 0) continue;
    due = true;
    if (draft.wakes >= maxWakes) {
      if (!draft.entries.some(entry => entry.kind === 'exhausted')) append({ kind: 'exhausted', maxWakes });
      continue;
    }
    draft.wakes += 1;
    member.run = 'working';
    member.cursor = head(draft);
    member.turnStart = member.cursor;
    draft.effects.push({ type: 'wake', member: member.name, threadId: member.threadId, entries: unread });
  }
  return due;
}
