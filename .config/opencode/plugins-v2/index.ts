import agentState from "./agent-state.ts"
import bellNotifications from "./bell-notifications.ts"
import securityPolicy from "./security-policy.ts"

type Context = Parameters<typeof agentState.setup>[0] & Parameters<typeof bellNotifications.setup>[0] & Parameters<typeof securityPolicy.setup>[0]

export default {
  id: "local-policy-and-notifications",
  setup: async (ctx: Context) => {
    const policyCleanup = await securityPolicy.setup(ctx)
    const stateCleanup = await agentState.setup(ctx)
    const bellCleanup = await bellNotifications.setup(ctx)
    return async () => {
      await bellCleanup()
      await stateCleanup?.()
      await policyCleanup()
    }
  },
}
