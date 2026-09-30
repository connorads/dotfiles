// What the voice use cases need from the outside world. Adapters: system.ts.
import type { JevChoice } from "./goto.ts"
import type { Pane, PaneId, Result } from "./pane.ts"
import type { Dir } from "./start.ts"

export type CycleState = "blocked" | "done"

export interface Ports {
  readonly listPanes: () => Promise<Result<readonly Pane[]>>
  // question: the key under `questions` whose answer to read.
  readonly judge: (body: unknown, question: string) => Promise<Result<JevChoice>>
  readonly jump: (pane: PaneId) => Promise<Result<void>>
  readonly currentPane: () => Promise<PaneId | undefined>
  readonly cycle: (state: CycleState, from: PaneId | undefined) => Promise<Result<void>>
  readonly listDirs: () => Promise<Result<readonly Dir[]>>
  // New window in the current tmux session, running claude in dir.
  readonly startAgent: (dir: string) => Promise<Result<PaneId>>
  readonly notify: (title: string, message: string) => Promise<void>
  readonly log: (entry: Record<string, unknown>) => Promise<void>
  readonly now: () => number
}
