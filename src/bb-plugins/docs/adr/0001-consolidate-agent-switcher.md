# Grow Claude Profiles into one Agent Switcher plugin

Claude Profiles absorbs Model Favourites and Agent Usage. The package stays
`bb-plugin-claude-profiles`, so the plugin ID stays `claude-profiles`. Its
display name is **Agent Switcher**. Its guide is the plugin
[README](../../claude-profiles/README.md).

## Context

Three plugins cover one daily task: choose who runs a thread and on what.

| Plugin | Owns | Calls |
| --- | --- | --- |
| [claude-profiles](../../claude-profiles/README.md) | Account bindings (`thread:<id>`), new-thread choice (`next-thread-profile`), env routing, post-launch guard, transcript handover, quota | `cache-hits` `invalidate` |
| `model-favourites` | Favourites (`favourites`), Alt+F picker | `claude-profiles` `accounts`, `choose` |
| `agent-usage` | Header badge, overview overlay, Codex reset-credit host entry | `bb--provider-usage`, `claude-profiles` `accounts`, `usage` |

The boundaries cost the following:

- The composer shows two account controls. They are the Claude Profiles chip and
  the account select in the favourites picker.
- The `accounts` output schema is written three times by hand:
  `claude-profiles/contracts.ts`, `model-favourites/profiles.ts` and
  `agent-usage/server.ts`. No compiler links them.
- Each caller checks at runtime whether Claude Profiles is enabled. A rename
  in one plugin fails only at runtime in another.
- Each plugin has its own build, SDK engine pin (`bb >=0.45` against `>=0.46`)
  and README. Each README describes the other plugins' behaviour.
- One owner ships all three plugins together. The boundaries give no
  independent release.

The concepts are **accounts** and **models**. The picker is a screen over both.

## Decision

- One plugin with two internal modules:
  - `accounts` owns bindings, routing, the guard, handover, quota and usage.
  - `models` owns favourites and their saved effort.
- The picker and the usage overlay are UI. They own no data and call the
  modules through the plugin's own typed RPC.
- A favourite saves one preferred effort per provider and model. Selecting the
  favourite restores that effort. A saved effort the model no longer supports
  disables selection, but the effort stays editable. A favourite without a
  saved effort uses the provider default. A change to the composer's current
  effort leaves saved efforts unchanged.
- New-thread account rule on stock BB 0.46:
  1. A thread started by another thread inherits that thread's bound account.
     BB marks a child with `parentThreadId`. BB marks a fork with
     `originKind: "fork"` and `sourceThreadId`.
  2. Any other thread uses the account shown in the new-thread composer
     (`next-thread-profile`).
  3. If the inherited account does not exist on the thread's machine, dispatch
     is refused with a reason. The plugin never falls back to another account.
- Model Favourites and Agent Usage stay installed until the user approves the
  cut-over. Favourites move by an explicit, idempotent
  `bb claude-profiles migrate-favourites`.

### Per-draft account choice needs patched BB

On stock BB 0.46 a native Send carries no plugin data. The
`message.dispatch` context has `experimental_submission`, but only
`composer.submit` called by a plugin fills it. The user's Enter does not.
Therefore a plugin cannot tell which account the user chose for one draft.
It can only read the remembered composer choice when the first message
dispatches. The patch spike adds `experimental_setSubmissionData` to native
Send. The daily install runs stock BB, so the plugin uses the rule above.

## Alternatives considered

- **New plugin ID `agent-switcher`.** BB scopes plugin KV storage by plugin ID.
  Every binding lives under `claude-profiles` as `thread:<id>`. A new ID starts
  with empty storage. The env contributor then returns nothing, and bound
  threads run on the default native login. The guard reviews only threads with
  a binding, so it does not detect the failure. A migration could copy the
  bindings, but each thread is unprotected until the copy completes. The patch
  spike used this ID with fresh data, so it never had existing bindings.
- **Keep three plugins and add saved effort to Model Favourites.** This solves
  effort. The duplicate account control and the three copies of the account
  schema stay.
- **One job per plugin**, for example routing, handover and quota apart. The
  env contributor, the dispatch hook and the guard all read the same bindings.
  If they are in different plugins, the safety check is in one plugin and the
  data is in another. Each split adds one more hand-copied contract and
  one more check for an enabled plugin.
- **One picker plugin over the three plugins.** The picker owns no data. It
  would be a fourth plugin that calls three contracts. This adds a boundary.
- **Upstream into BB.** Account routing needs BB changes:
  `contributeRequiredEnv` and native submission data. The spike carries these
  as three patches on BB 0.46.0. The daily install is stock BB, and the owner
  does not control BB releases. The plugin must work without the patches.

## Consequences

- Fault isolation decreases. Before, a failure in favourites or usage code
  could not affect account routing. Now one failed plugin load also removes the
  env contributor. BB then starts Claude on the native login, and the guard is
  not loaded to stop it. Mitigations:
  - Each module has its own tests.
  - The usage reader catches source failures at its RPC boundary.
  - Every build is tested in a temporary copy before live BB reloads it.
- Bindings stay in place. Account data needs no migration. Rollback means:
  rebuild the previous commit, then enable the two old plugins again.
- Favourites move into Claude Profiles storage under `favourites`. The data in
  Model Favourites stays. After a rollback, it is still the active list.
- Threads that agents start follow their parent's account. They do not use the
  remembered new-thread choice. A missing parent account blocks the send.
