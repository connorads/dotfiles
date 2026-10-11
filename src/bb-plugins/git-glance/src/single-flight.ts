/**
 * Runs `task` at most once at a time. A trigger during a run queues exactly one
 * follow-up run, so a burst of triggers costs two runs, and the last one sees
 * every change. `hold` defers runs until `release`, which then runs once: the
 * work done while held (a pull, a push) is itself a change.
 */
export function singleFlight(task: () => Promise<void>) {
  let running: Promise<void> | null = null;
  let pending = false;
  let holds = 0;
  function start() {
    pending = false;
    running = task().catch(() => {}).finally(() => {
      running = null;
      if (pending && holds === 0) start();
    });
  }
  return {
    trigger() {
      if (running || holds > 0) pending = true;
      else start();
    },
    hold() { holds++; },
    release() {
      holds = Math.max(0, holds - 1);
      if (holds > 0) return;
      if (running) pending = true; else start();
    },
    /** Resolves once no run is in flight or queued. */
    async idle() { while (running) await running; },
  };
}
