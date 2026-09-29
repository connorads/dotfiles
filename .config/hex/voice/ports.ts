// What the voice use cases need from the outside world. Adapters: system.ts.
import type { JevChoice } from "./goto.ts"
import type { Pane, PaneId, Result } from "./pane.ts"

export type CycleState = "blocked" | "done"

export interface Ports {
  readonly listPanes: () => Promise<Result<readonly Pane[]>>
  readonly judge: (body: unknown) => Promise<Result<JevChoice>>
  readonly jump: (pane: PaneId) => Promise<Result<void>>
  readonly currentPane: () => Promise<PaneId | undefined>
  readonly cycle: (state: CycleState, from: PaneId | undefined) => Promise<Result<void>>
  readonly notify: (title: string, message: string) => Promise<void>
  readonly log: (entry: Record<string, unknown>) => Promise<void>
  readonly now: () => number
}
