// What the BB voice commands need from the outside world. Adapters: system.ts.
import type { JevChoice, Result } from "./jev.ts"

export interface Ports {
  // question: the key under `questions` whose answer to read.
  readonly judge: (body: unknown, question: string) => Promise<Result<JevChoice>>
  readonly notify: (title: string, message: string) => Promise<void>
  readonly log: (entry: Record<string, unknown>) => Promise<void>
}
