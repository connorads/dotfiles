/** A row from threads.listRunning(): status starting or active, with the host whose pool it occupies. */
export interface RunningRow { id: string; hostId: string | null }
/** The fields of a threads.list() row that decide whether it counts. */
export interface ThreadRow {
  id: string;
  environmentHostId: string | null;
  hasPendingInteraction: boolean;
  activity: { activeBackgroundAgentCount: number };
}

/**
 * Threads on this Mac that should keep it awake. A thread waiting on a
 * permission or question does not count, so a forgotten prompt cannot hold
 * the Mac awake for ever. An idle thread still running a background agent
 * counts; one with only background commands does not, because a dev server
 * never ends.
 */
export function busyCount(running: readonly RunningRow[], threads: readonly ThreadRow[], hostId: string): number {
  const waiting = new Set(threads.filter(thread => thread.hasPendingInteraction).map(thread => thread.id));
  const busy = new Set<string>();
  for (const row of running) if (row.hostId === hostId && !waiting.has(row.id)) busy.add(row.id);
  for (const thread of threads) {
    if (thread.environmentHostId === hostId && !thread.hasPendingInteraction && thread.activity.activeBackgroundAgentCount > 0) busy.add(thread.id);
  }
  return busy.size;
}
