// Use cases: gather, decide, act, log. Failures end as a notification, never a throw.
import { decideGoto, gotoQuestion, type GotoDecision } from "./goto.ts"
import type { CycleState, Ports } from "./ports.ts"

const TITLE = "Go to pane"

export type GotoOutcome = GotoDecision["kind"] | "error"

const describe = (d: GotoDecision) =>
  d.kind === "jump"
    ? { pane: d.pane.id, title: d.pane.title, p: d.p }
    : d.kind === "ask"
      ? { reason: d.reason, options: d.options.map((o) => ({ pane: o.pane.id, title: o.pane.title, p: o.p })) }
      : { reason: d.reason }

export const runGoto = async (ports: Ports, utterance: string): Promise<GotoOutcome> => {
  const started = ports.now()
  const finish = async (outcome: GotoOutcome, detail: Record<string, unknown>) => {
    await ports.log({ command: "goto", utterance, outcome, ms: ports.now() - started, ...detail })
    return outcome
  }
  const fail = async (error: string) => {
    await ports.notify(TITLE, error)
    return finish("error", { error })
  }

  const panes = await ports.listPanes()
  if (!panes.ok) return fail(panes.error)
  if (panes.value.length === 0) return fail("no agent panes found")

  const answer = await ports.judge(gotoQuestion(utterance, panes.value))
  if (!answer.ok) return fail(answer.error)

  const decision = decideGoto(answer.value, panes.value)
  const detail = { panes: panes.value.length, confidence: answer.value.confidence, ...describe(decision) }
  switch (decision.kind) {
    case "jump": {
      const jumped = await ports.jump(decision.pane.id)
      if (!jumped.ok) return fail(jumped.error)
      return finish("jump", detail)
    }
    case "ask": {
      const options = decision.options.map((o) => `${o.pane.title || o.pane.id} (${o.pane.project})`)
      await ports.notify(`${TITLE}: which one?`, options.join(" or "))
      return finish("ask", detail)
    }
    case "nomatch":
      await ports.notify(TITLE, `No match for "${utterance}"`)
      return finish("nomatch", detail)
  }
}

export const runNext = async (ports: Ports, state: CycleState): Promise<boolean> => {
  const started = ports.now()
  const from = await ports.currentPane()
  const cycled = await ports.cycle(state, from)
  if (!cycled.ok) await ports.notify(`Next ${state}`, cycled.error)
  await ports.log({
    command: "next",
    state,
    from: from ?? null,
    outcome: cycled.ok ? "cycle" : "error",
    ms: ports.now() - started,
    ...(cycled.ok ? {} : { error: cycled.error }),
  })
  return cycled.ok
}
