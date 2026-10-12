// Hibernate = stop an idle thread's runtime so its provider process exits and
// returns its pages to both compressor arms. bb keeps the transcript and
// resumes the session on the next message, so there is no record, park or
// thaw to build. Manual only (dotfiles ADR 0017): nothing here runs unasked.
import type { Work } from './triage.ts';

/** The thread facts the gate reads, fetched fresh just before each stop. */
export interface ThreadFacts {
  status: string;
  runtimeStatus: string;
  queuedMessageCount: number;
  activeBackgroundAgentCount: number;
  pendingInteractions: number;
  archived: boolean;
}

/** Why bb's own state forbids a stop now, or null when the thread is idle. */
export function refusal(facts: ThreadFacts): string | null {
  if (facts.archived) return 'archived';
  if (facts.pendingInteractions > 0) return 'waiting for input';
  if (facts.status !== 'idle' || facts.runtimeStatus !== 'idle') return facts.status === 'idle' ? facts.runtimeStatus : facts.status;
  if (facts.queuedMessageCount > 0) return 'message queued';
  if (facts.activeBackgroundAgentCount > 0) return 'background agent running';
  return null;
}

/**
 * An idle bb status does not mean an idle process tree: a stop ends every
 * descendant, so a commit hook or build still running under the thread
 * would die with it. The reason names the command.
 */
export function workRefusal(work: Work): string {
  const more = work.processes - 1;
  return `running ${work.command}${more > 0 ? ` (+${more} more process${more === 1 ? '' : 'es'})` : ''}`;
}

export type Outcome =
  | { threadId: string; outcome: 'hibernated' }
  /** bb accepted the stop but the provider process outlived the settle window. */
  | { threadId: string; outcome: 'still-running' }
  | { threadId: string; outcome: 'refused'; reason: string }
  | { threadId: string; outcome: 'failed'; reason: string };

export interface HibernatePorts {
  facts(threadId: string): Promise<ThreadFacts>;
  /** The live work under each thread's provider process; a thread without a process is absent. */
  processes(threadIds: string[]): Promise<Map<string, Work | null>>;
  stop(threadId: string): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export interface SettleOptions { settleMs: number; pollMs: number }

const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

/**
 * The full gate, read fresh just before a stop: bb's state, then the
 * machine's process tree, then bb's state again. The process read takes a
 * second or more, and a message sent meanwhile starts a turn with no child
 * process yet, so only the second bb read catches it. Fails closed: an
 * unreadable machine refuses.
 */
async function gate(threadId: string, ports: HibernatePorts): Promise<string | null> {
  const reason = refusal(await ports.facts(threadId));
  if (reason) return reason;
  let live: Map<string, Work | null>;
  try {
    live = await ports.processes([threadId]);
  } catch (cause) {
    return `cannot read the machine's processes (${message(cause)})`;
  }
  if (!live.has(threadId)) return 'no provider process on this machine';
  const work = live.get(threadId);
  if (work) return workRefusal(work);
  return refusal(await ports.facts(threadId));
}

/**
 * Every selected thread is attempted in turn; one failure never stops the rest.
 * All stopped threads then share one settle window, so N slow exits cost one
 * window, not N.
 */
export async function hibernateAll(threadIds: string[], ports: HibernatePorts, { settleMs, pollMs }: SettleOptions): Promise<Outcome[]> {
  const outcomes = new Map<string, Outcome>();
  const stopped: string[] = [];
  for (const threadId of new Set(threadIds)) {
    try {
      const reason = await gate(threadId, ports);
      if (reason) { outcomes.set(threadId, { threadId, outcome: 'refused', reason }); continue; }
      await ports.stop(threadId);
      stopped.push(threadId);
      outcomes.set(threadId, { threadId, outcome: 'still-running' });
    } catch (cause) {
      outcomes.set(threadId, { threadId, outcome: 'failed', reason: message(cause) });
    }
  }
  let pending = stopped;
  for (let waited = 0; pending.length > 0; waited += pollMs) {
    let live: Map<string, Work | null>;
    try {
      live = await ports.processes(pending);
    } catch {
      break; // The host cannot be read: the stops stand, reported as still running.
    }
    const running = (threadId: string) => live.has(threadId);
    for (const threadId of pending) if (!running(threadId)) outcomes.set(threadId, { threadId, outcome: 'hibernated' });
    pending = pending.filter(running);
    if (pending.length === 0 || waited >= settleMs) break;
    await ports.sleep(pollMs);
  }
  return [...outcomes.values()];
}

export function summarise(outcomes: Outcome[]): string {
  const counts = { hibernated: 0, 'still-running': 0, refused: 0, failed: 0 };
  for (const outcome of outcomes) counts[outcome.outcome] += 1;
  const parts = [`${counts.hibernated} hibernated`];
  if (counts['still-running']) parts.push(`${counts['still-running']} stopped but still running`);
  parts.push(`${counts.refused} refused`, `${counts.failed} failed`);
  return parts.join(', ');
}
