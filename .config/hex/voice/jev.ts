// Jev, the TypeSafe model that picks a BB thread, project or model from a
// spoken description, and the Result type the voice ports return. Pure.

export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })

export const JEV_MODEL = "jev-latest"

export interface JevChoice {
  readonly choice: string
  readonly probabilities: Readonly<Record<string, number>>
  readonly confidence: number
}

export const parseJevChoice = (body: unknown, question: string): Result<JevChoice> => {
  const a = (body as { answers?: Record<string, unknown> } | null)?.answers?.[question]
  if (typeof a !== "object" || a === null) return err(`Jev response has no answers.${question}`)
  const { choice, probabilities, confidence } = a as Record<string, unknown>
  if (typeof choice !== "string") return err("Jev answer has no choice")
  if (typeof probabilities !== "object" || probabilities === null) return err("Jev answer has no probabilities")
  const probs = Object.fromEntries(
    Object.entries(probabilities).filter((e): e is [string, number] => typeof e[1] === "number"),
  )
  return ok({ choice, probabilities: probs, confidence: typeof confidence === "number" ? confidence : 0 })
}
