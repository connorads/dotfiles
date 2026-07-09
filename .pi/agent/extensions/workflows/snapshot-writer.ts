import type { WorkflowRunSnapshot } from "./domain.ts";
import type { WorkflowStore } from "./store.ts";

/** Default debounce window for soft snapshot writes. */
export const DEFAULT_SNAPSHOT_FLUSH_MS = 250;

/** Scheduler port that hides timer handles behind one-shot cancellation. */
export interface SnapshotWriteScheduler {
  schedule(callback: () => void, ms: number): () => void;
}

/** Dependencies for coalescing durable workflow snapshot writes. */
export interface WorkflowSnapshotWriterDeps {
  readonly store: Pick<WorkflowStore, "updateRun">;
  readonly generation?: number;
  readonly flushMs?: number;
  readonly scheduler?: SnapshotWriteScheduler;
  readonly onSoftWriteError?: (error: unknown) => void;
}

/**
 * Coalesces high-volume observation updates while preserving immediate writes
 * for lifecycle transitions that later resume/replay depends on.
 */
export class WorkflowSnapshotWriter {
  private readonly deps: WorkflowSnapshotWriterDeps;
  private readonly scheduler: SnapshotWriteScheduler;
  private pending: WorkflowRunSnapshot | undefined;
  private cancelTimer: (() => void) | undefined;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(deps: WorkflowSnapshotWriterDeps) {
    this.deps = deps;
    this.scheduler = deps.scheduler ?? defaultScheduler();
  }

  /** Queue a soft observation write such as progress, log, or phase updates. */
  touch(snapshot: WorkflowRunSnapshot): void {
    if (this.disposed) return;
    this.pending = snapshot;
    if (this.cancelTimer !== undefined) return;
    this.cancelTimer = this.scheduler.schedule(() => {
      void this.flush().catch((error) => this.deps.onSoftWriteError?.(error));
    }, this.deps.flushMs ?? DEFAULT_SNAPSHOT_FLUSH_MS);
  }

  /** Persist a required state transition after draining any pending soft write. */
  async writeNow(snapshot: WorkflowRunSnapshot): Promise<void> {
    if (this.disposed) throw new Error("Cannot write workflow snapshot after writer disposal");
    this.pending = snapshot;
    await this.flush();
  }

  private async flush(): Promise<void> {
    const snapshot = this.pending;
    this.pending = undefined;
    this.clearTimer();
    if (snapshot === undefined) {
      await this.chain;
      return;
    }

    const write = this.chain.then(() => this.deps.store.updateRun(snapshot, this.deps.generation));
    this.chain = write.catch(() => {});
    await write;
  }

  /** Drain pending work and prevent future soft timers from writing stale state. */
  async drainAndDispose(): Promise<void> {
    try {
      await this.flush();
    } finally {
      this.disposed = true;
      this.clearTimer();
      this.pending = undefined;
    }
  }

  private clearTimer(): void {
    if (this.cancelTimer === undefined) return;
    this.cancelTimer();
    this.cancelTimer = undefined;
  }
}

function defaultScheduler(): SnapshotWriteScheduler {
  return {
    schedule(callback, ms) {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    },
  };
}
