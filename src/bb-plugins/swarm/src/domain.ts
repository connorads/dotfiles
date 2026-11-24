declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type MemberName = Brand<string, 'MemberName'>;
export type ThreadId = Brand<string, 'ThreadId'>;
/** Position of an entry on the board. The first entry is 1; 0 means "nothing yet". */
export type Seq = Brand<number, 'Seq'>;

export const coordinatorName = 'coordinator' as MemberName;
export const noSeq = 0 as Seq;

export type Author = MemberName | 'human' | 'engine';

export type EntryBody =
  | { kind: 'post'; author: Author; text: string; mentions: readonly MemberName[] }
  | { kind: 'joined'; member: MemberName; brief: string }
  /** A worker's turn ended without a post, so the engine relayed its final reply. */
  | { kind: 'reply'; member: MemberName; text: string }
  | { kind: 'failed'; member: MemberName; error: string }
  /** The member's thread is gone: archived, deleted or stopped outside the swarm. */
  | { kind: 'left'; member: MemberName }
  | { kind: 'exhausted'; maxWakes: number }
  | { kind: 'closed'; summary: string };

export type Entry = { seq: Seq; at: number } & EntryBody;

export type Run = 'working' | 'idle' | 'failed' | 'stopped';

export interface Member {
  name: MemberName;
  threadId: ThreadId;
  role: 'coordinator' | 'worker';
  run: Run;
  /** Highest seq delivered to this member. */
  cursor: Seq;
  /** Board head when the member's current turn started. */
  turnStart: Seq;
}

export interface Limits {
  maxMembers: number;
  maxWakes: number;
}

export interface Swarm {
  entries: readonly Entry[];
  members: readonly Member[];
  limits: Limits;
  wakes: number;
  /** Board head left by the last stall notice, so one quiet board gets one notice. */
  stallNoticeAt: Seq | null;
}

const reservedNames = new Set(['human', 'engine', 'all', coordinatorName]);
const namePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const mentionPattern = /(?<![\w@])@([a-z0-9]+(?:-[a-z0-9]+)*)/gi;

export function parseMemberName(raw: string): MemberName | null {
  const name = raw.trim().toLowerCase();
  if (name.length > 32 || !namePattern.test(name) || reservedNames.has(name)) return null;
  return name as MemberName;
}

export function openSwarm(coordinatorThreadId: ThreadId, limits: Limits): Swarm {
  return {
    entries: [],
    members: [
      {
        name: coordinatorName,
        threadId: coordinatorThreadId,
        role: 'coordinator',
        // The coordinator opens the swarm from inside its own turn.
        run: 'working',
        cursor: noSeq,
        turnStart: noSeq,
      },
    ],
    limits,
    wakes: 0,
    stallNoticeAt: null,
  };
}

export function head(swarm: Pick<Swarm, 'entries'>): Seq {
  return swarm.entries.at(-1)?.seq ?? noSeq;
}

export function isClosed(swarm: Pick<Swarm, 'entries'>): boolean {
  return swarm.entries.at(-1)?.kind === 'closed';
}

export function isLive(member: Member): boolean {
  return member.run === 'working' || member.run === 'idle';
}

export function memberByThread(swarm: Swarm, threadId: ThreadId): Member | null {
  return swarm.members.find(member => member.threadId === threadId) ?? null;
}

export interface Mentions {
  known: MemberName[];
  unknown: string[];
}

/** `@name` rings a live member; `@all` rings every live member. The author is never rung. */
export function parseMentions(text: string, author: Author, members: readonly Member[]): Mentions {
  const live = members.filter(member => isLive(member) && member.name !== author).map(member => member.name);
  const known = new Set<MemberName>();
  const unknown = new Set<string>();
  for (const match of text.matchAll(mentionPattern)) {
    const name = match[1]!.toLowerCase();
    if (name === 'all') live.forEach(member => known.add(member));
    else if (live.includes(name as MemberName)) known.add(name as MemberName);
    else if (name !== author) unknown.add(name);
  }
  return { known: [...known], unknown: [...unknown] };
}

/** Whether an entry is a reason to wake this member. */
export function concerns(entry: Entry, member: Member): boolean {
  switch (entry.kind) {
    case 'post':
      if (entry.author === member.name) return false;
      if (entry.mentions.includes(member.name)) return true;
      // A human post that names nobody goes to the coordinator.
      return entry.author === 'human' && entry.mentions.length === 0 && member.role === 'coordinator';
    case 'reply':
    case 'failed':
    case 'left':
      return member.role === 'coordinator' && entry.member !== member.name;
    case 'joined':
    case 'exhausted':
    case 'closed':
      return false;
  }
}
