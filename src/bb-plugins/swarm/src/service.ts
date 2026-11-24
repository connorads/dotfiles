import type { Board } from './board.ts';
import {
  head,
  isLive,
  memberByThread,
  openSwarm,
  parseMemberName,
  parseMentions,
  type Limits,
  type Member,
  type MemberName,
  type Swarm,
  type SwarmId,
  type ThreadId,
} from './domain.ts';
import { decide, type Effect, type Input } from './engine.ts';
import { explain, formatBoard, formatBrief, formatRoster, formatWake, viewBoard, type BoardView } from './format.ts';

/** The agent threads a swarm runs on. */
export interface Agents {
  /** Starts a worker thread beside the coordinator and gives it its first prompt. */
  spawn(request: SpawnRequest): Promise<ThreadId>;
  /** Starts a turn on an idle thread, or queues behind its running turn. */
  wake(threadId: ThreadId, text: string, sender: ThreadId | null): Promise<void>;
  stop(threadId: ThreadId): Promise<void>;
  /** What the thread is doing now, for members whose events were missed. */
  observe(threadId: ThreadId): Promise<Observed>;
}

export type Observed = { state: 'working' } | { state: 'idle'; lastReply: string | null } | { state: 'failed'; error: string } | { state: 'gone' };

export interface SpawnRequest {
  swarmId: SwarmId;
  coordinatorThreadId: ThreadId;
  name: MemberName;
  prompt: string;
  provider: string | null;
  model: string | null;
}

export interface Deps {
  board: Board;
  agents: Agents;
  now(): number;
  newId(): SwarmId;
  limits(): Promise<Limits>;
  /** Reports a failure nobody is waiting on, such as a wake that could not be sent. */
  log(message: string): void;
  /** Tells open panels that a board changed. */
  changed(id: SwarmId): void;
  /** The chat directive that renders this swarm's card. */
  card(id: SwarmId): string;
}

export interface Outcome {
  ok: boolean;
  text: string;
}

export interface AddRequest {
  name: string;
  brief: string;
  provider: string | null;
  model: string | null;
}

type Command = Extract<Input, { type: 'join' | 'post' | 'close' }>;
type Lifecycle = Exclude<Input, Command>;
type Unstamped<I> = I extends unknown ? Omit<I, 'at'> : never;

const notInSwarm: Outcome = { ok: false, text: 'This thread is not in an open swarm. The swarm tool with action "add" starts one.' };

export function createService(deps: Deps) {
  const { board, agents } = deps;

  /** Decides, saves and performs the effects of one input. */
  function apply(id: SwarmId, input: Unstamped<Input>): { swarm: Swarm } | { refusal: string } {
    const swarm = board.load(id);
    if (!swarm) return { refusal: notInSwarm.text };
    const decision = decide(swarm, { ...input, at: deps.now() } as Input);
    if (!decision.ok) return { refusal: explain(decision.error) };
    board.save(id, swarm, decision.swarm);
    if (decision.swarm !== swarm) deps.changed(id);
    for (const effect of decision.effects) void perform(id, decision.swarm, effect);
    return { swarm: decision.swarm };
  }

  async function perform(id: SwarmId, swarm: Swarm, effect: Effect): Promise<void> {
    try {
      if (effect.type === 'stop') return await agents.stop(effect.threadId);
      const member = swarm.members.find(candidate => candidate.name === effect.member)!;
      await agents.wake(effect.threadId, formatWake(member, effect.entries), senderOf(swarm, effect));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      deps.log(`swarm ${id}: ${effect.type} ${effect.member} failed: ${reason}`);
      if (effect.type === 'wake') apply(id, { type: 'turnFailed', member: effect.member, error: `The wake could not be delivered: ${reason}` });
    }
  }

  function locate(threadId: ThreadId): { id: SwarmId; swarm: Swarm; member: Member } | null {
    const id = board.openFor(threadId);
    const swarm = id && board.load(id);
    const member = swarm && memberByThread(swarm, threadId);
    return id && swarm && member ? { id, swarm, member } : null;
  }

  function lifecycle(threadId: ThreadId, input: (member: MemberName) => Unstamped<Lifecycle>): void {
    const found = locate(threadId);
    if (found) apply(found.id, input(found.member.name));
  }

  return {
    /** Adds a worker. The first call from a thread opens a swarm with that thread as coordinator. */
    async add(threadId: ThreadId, request: AddRequest): Promise<Outcome> {
      const name = parseMemberName(request.name);
      if (!name) return { ok: false, text: `"${request.name}" is not a usable name. Use lowercase letters, digits and hyphens, at most 32 characters.` };
      const brief = request.brief.trim();
      if (!brief) return { ok: false, text: 'The brief is empty.' };

      let found = locate(threadId);
      if (!found) {
        const limits = await deps.limits();
        // A parallel add from the same thread may have opened one while limits loaded.
        if (!board.openFor(threadId)) board.create(deps.newId(), openSwarm(threadId, limits), deps.now());
        found = locate(threadId);
        if (!found) return notInSwarm;
      }
      const { id, swarm, member } = found;
      const join = (worker: ThreadId): Unstamped<Command> => ({ type: 'join', by: member.name, name, threadId: worker, brief });
      const check = decide(swarm, { ...join(threadId), at: deps.now() });
      if (!check.ok) return { ok: false, text: explain(check.error) };

      const worker = await agents.spawn({
        swarmId: id,
        coordinatorThreadId: threadId,
        name,
        prompt: formatBrief(name, brief),
        provider: request.provider,
        model: request.model,
      });
      const joined = apply(id, join(worker));
      if ('refusal' in joined) {
        await agents.stop(worker);
        return { ok: false, text: joined.refusal };
      }
      const joinedText = `${name} joined and is working on its brief (#${head(joined.swarm)}). End your turn to wait. A mention of @coordinator wakes you.`;
      // The first worker's entry is #1. Its result carries the card, so later adds do not repeat it.
      const card = head(joined.swarm) === 1 ? `\nPut this line on its own in your reply, exactly once, so the user sees the live board: ${deps.card(id)}` : '';
      return { ok: true, text: joinedText + card };
    },

    post(threadId: ThreadId, text: string): Outcome {
      const found = locate(threadId);
      if (!found) return notInSwarm;
      const { unknown } = parseMentions(text, found.member.name, found.swarm.members);
      const posted = apply(found.id, { type: 'post', author: found.member.name, text });
      if ('refusal' in posted) return { ok: false, text: posted.refusal };
      const entry = posted.swarm.entries.find(candidate => candidate.seq > head(found.swarm) && candidate.kind === 'post');
      const mentions = entry?.kind === 'post' ? entry.mentions : [];
      const notes = [
        `Posted #${entry?.seq}.`,
        mentions.length ? `Mentioned: ${mentions.join(', ')}.` : 'Nobody was mentioned, so nobody will be woken.',
        ...(unknown.length ? [`No live member is named ${unknown.map(name => `@${name}`).join(', ')}.`] : []),
      ];
      return { ok: true, text: notes.join(' ') };
    },

    read(threadId: ThreadId, since: number | null): Outcome {
      const found = locate(threadId);
      if (!found) return notInSwarm;
      return { ok: true, text: formatBoard(found.swarm, since ?? Math.max(0, head(found.swarm) - 20)) };
    },

    close(threadId: ThreadId, summary: string): Outcome {
      const found = locate(threadId);
      if (!found) return notInSwarm;
      const closed = apply(found.id, { type: 'close', by: found.member.name, summary });
      return 'refusal' in closed ? { ok: false, text: closed.refusal } : { ok: true, text: 'Swarm closed. Every worker was stopped.' };
    },

    turnStarted: (threadId: ThreadId) => lifecycle(threadId, member => ({ type: 'turnStarted', member })),
    turnEnded: (threadId: ThreadId, lastReply: string | null) => lifecycle(threadId, member => ({ type: 'turnEnded', member, lastReply })),
    turnFailed: (threadId: ThreadId, error: string) => lifecycle(threadId, member => ({ type: 'turnFailed', member, error })),

    threadGone,

    /** Open swarms, for a caller that is not a member. */
    list(): { id: SwarmId; roster: string }[] {
      return board.open().flatMap(id => {
        const swarm = board.load(id);
        return swarm ? [{ id, roster: formatRoster(swarm.members) }] : [];
      });
    },
    swarmOf: (threadId: ThreadId): SwarmId | null => board.openFor(threadId),

    /** The newest swarm this thread has been in, for the board panel. */
    view(threadId: ThreadId): BoardView | null {
      const id = board.latestFor(threadId);
      const swarm = id && board.load(id);
      return id && swarm ? viewBoard(id, swarm) : null;
    },
    viewById(id: SwarmId): BoardView | null {
      const swarm = board.load(id);
      return swarm ? viewBoard(id, swarm) : null;
    },

    humanRead(id: SwarmId, since: number | null): Outcome {
      const swarm = board.load(id);
      return swarm ? { ok: true, text: formatBoard(swarm, since ?? 0) } : { ok: false, text: `No swarm has the id ${id}.` };
    },
    humanPost(id: SwarmId, text: string): Outcome {
      const posted = apply(id, { type: 'post', author: 'human', text });
      return 'refusal' in posted ? { ok: false, text: posted.refusal } : { ok: true, text: `Posted #${head(posted.swarm)} as human.` };
    },
    humanClose(id: SwarmId, summary: string): Outcome {
      const closed = apply(id, { type: 'close', by: 'human', summary });
      return 'refusal' in closed ? { ok: false, text: closed.refusal } : { ok: true, text: 'Swarm closed. Every worker was stopped.' };
    },

    /**
     * Replays what happened to each live member while the plugin was not listening.
     * A wake lost in that gap is not re-sent; the stall notice tells the coordinator.
     */
    async reconcile(): Promise<void> {
      for (const id of board.open()) {
        for (const member of board.load(id)?.members.filter(isLive) ?? []) {
          try {
            const observed = await agents.observe(member.threadId);
            if (observed.state === 'gone') threadGone(member.threadId);
            else if (observed.state === 'working') apply(id, { type: 'turnStarted', member: member.name });
            else if (observed.state === 'idle') apply(id, { type: 'turnEnded', member: member.name, lastReply: observed.lastReply });
            else apply(id, { type: 'turnFailed', member: member.name, error: observed.error });
          } catch (error) {
            deps.log(`swarm ${id}: could not observe ${member.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    },
  };

  /** The thread was archived or deleted. Losing the coordinator ends the swarm. */
  function threadGone(threadId: ThreadId): void {
    const found = locate(threadId);
    if (!found) return;
    if (found.member.role === 'coordinator') apply(found.id, { type: 'close', by: 'human', summary: 'The coordinator thread is gone.' });
    else apply(found.id, { type: 'gone', member: found.member.name });
  }
}

export type Service = ReturnType<typeof createService>;

/** The thread a wake is attributed to: the author when one member wrote every entry. */
function senderOf(swarm: Swarm, effect: Extract<Effect, { type: 'wake' }>): ThreadId | null {
  const authors = new Set(effect.entries.map(entry => (entry.kind === 'post' ? entry.author : entry.kind === 'reply' ? entry.member : 'engine')));
  if (authors.size !== 1) return null;
  const [author] = authors;
  return swarm.members.find(member => member.name === author)?.threadId ?? null;
}
