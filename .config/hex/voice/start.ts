// "start agent in <project>": the zoxide candidates, the Jev question and the
// start policy. Pure.
import { JEV_MODEL, JUMP_FLOOR, NONE, type JevChoice } from "./goto.ts"

// Covers the folders actually used: ~ plus the top 5 are ~75% of sessions.
export const MAX_DIRS = 25

export interface Dir {
  readonly path: string
  readonly label: string
}

export interface ScoredDir {
  readonly dir: Dir
  readonly p: number
}

export type StartDecision =
  | { readonly kind: "start"; readonly dir: Dir; readonly p: number }
  | { readonly kind: "ask"; readonly options: readonly ScoredDir[] }
  | { readonly kind: "nomatch"; readonly reason: string }

export const dirLabel = (path: string, home: string): string =>
  path === home ? "home, dotfiles" : path.startsWith(`${home}/`) ? path.slice(home.length + 1) : path

// out: `zoxide query -l -s`, highest score first, missing dirs already dropped.
export const parseZoxide = (out: string, home: string): readonly Dir[] => {
  const paths = out
    .split("\n")
    .map((line) => line.trim().replace(/^[\d.]+\s+/, ""))
    .filter((path) => path.startsWith("/"))
    .slice(0, MAX_DIRS)
  const withHome = paths.includes(home) ? paths : [...paths, home]
  return withHome.map((path) => ({ path, label: dirLabel(path, home) }))
}

// Paths make poor Jev keys, so dirs are keyed d1..dN in list order.
const keyOf = (i: number) => `d${i + 1}`

export const startQuestion = (utterance: string, dirs: readonly Dir[]) => ({
  model: JEV_MODEL,
  state: { utterance },
  questions: {
    dir: {
      type: "choice",
      instructions:
        "The user spoke `utterance` (speech-to-text, may be misheard) to start a coding agent in one of their project folders. Labels are paths relative to their home folder. Which folder do they mean? Answer none if no folder fits.",
      criteria: {
        ...Object.fromEntries(dirs.map((d, i) => [keyOf(i), d.label])),
        [NONE]: "none of these folders; the user means something else",
      } as Record<string, string>,
    },
  },
})

export const decideStart = (answer: JevChoice, dirs: readonly Dir[]): StartDecision => {
  const byKey = new Map<string, Dir>(dirs.map((d, i) => [keyOf(i), d]))
  const ranked = Object.entries(answer.probabilities).sort((x, y) => y[1] - x[1])
  const [top] = ranked
  if (top === undefined) return { kind: "nomatch", reason: "Jev returned no probabilities" }
  const [topKey, topP] = top
  if (topKey === NONE) return { kind: "nomatch", reason: "no folder matches" }
  const dir = byKey.get(topKey)
  if (dir === undefined) return { kind: "nomatch", reason: `Jev chose unknown folder ${topKey}` }
  if (topP < JUMP_FLOOR) {
    const options = ranked.flatMap(([key, p]) => {
      const found = byKey.get(key)
      return found ? [{ dir: found, p }] : []
    })
    return { kind: "ask", options: options.slice(0, 2) }
  }
  return { kind: "start", dir, p: topP }
}
