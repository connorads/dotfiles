# AI Extensions (tools + evals) reference

AI Extensions let Raycast AI (and AI Chat) call your extension's functions. They live **inside a normal extension** alongside `commands`. AI features require the user to have **Raycast Pro**.

## Tools vs commands

- **Command** = user-launched entry point (`mode: view|no-view|menu-bar`), listed in `package.json#commands`, source in `src/<command>.tsx`.
- **Tool** = a headless `(input) => value` function the **AI** decides to call. Listed in `package.json#tools`, source in `src/tools/<name>.ts`. No UI, no `mode`.
- **Expose a tool** when the action is a discrete, parameterised data fetch or mutation the model should orchestrate (search issues, create issue, merge PR). **Keep it a command** when it needs interactive UI or isn't useful to an LLM. Big extensions ship both, and split read-then-act flows into small chainable tools (`search-repositories` → `search-pull-requests` → `merge-pull-request`).

## File layout

```text
src/tools/
  create-issue.ts     # default export = the tool fn; optional `confirmation` export
  get-current-user.ts
```

One file per tool; the kebab-case filename **must** equal the tool `name` in `package.json#tools`.

## Defining a tool

The input schema is derived from a TS type named **exactly `Input`**. **The JSDoc on each field IS the prompt** the model reads to choose arguments — write it carefully.

```ts
// src/tools/create-issue.ts
import { withAccessToken } from "@raycast/utils";
import { service, getClient } from "../api/client";

type Input = {
  /** The title of the issue */
  title: string;
  /** The ID of the team. Do not ask the user to specify a team if there is only one. */
  teamId: string;
  /** Label IDs to assign. Never pass a label name — call get-labels first to resolve the ID. */
  labelIds?: string[];
  /** Priority 0-4 (0 = none, 4 = urgent) */
  priority?: number;
};

// default export = the tool. Typed input in, JSON-serialisable value out (fed back to the model).
export default withAccessToken(service)(async (input: Input) => {
  return getClient().createIssue(input);   // return concise structured data, not the whole API blob
});
```

- Use `?` optional fields for anything the model may omit; guide selection and tool-chaining via JSDoc.
- Wrap with the same auth HOF (`withAccessToken`) as commands. There's no special "tool wrapper".
- Keep tools small and single-purpose; split read vs mutate.

## Confirmations (destructive / mutating tools)

Export a named `confirmation` next to the default export. It runs **before** the tool, receives the **same `Input`**, and returns either a descriptor (Raycast shows an approve/deny card) or `undefined` to skip.

```ts
import { Action, Tool } from "@raycast/api";

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  if (!input.id) return undefined;                        // nothing destructive yet → skip
  return {
    style: Action.Style.Destructive,                      // for genuinely dangerous ops
    message: "Are you sure you want to delete this issue?",
    info: [{ name: "Issue", value: `#${input.id}` }],     // enumerate exactly what changes
  };
};
```

- Prefer `info` (the precise side-effect summary) over a long `message`.
- AI callers often pass `""`/`[]` for optional IDs — guard empties before doing lookups inside `confirmation` or you get "Entity not found"/TypeError before the real op.
- **Every mutating/deleting tool needs a `confirmation`** — store review flags AI tools that change state without one.

## `package.json` config

```json
"tools": [
  { "name": "get-issues",  "title": "Get Issues",  "description": "Get issues from My Service" },
  { "name": "create-issue", "title": "Create Issue", "description": "Create a new issue" }
],
"ai": {
  "instructions": "- Format issues as markdown links. - Use search-repositories first unless the user gave owner/repo.",
  "evals": [ /* see below */ ]
}
```

- Tool `description` is shown in the UI **and given to the AI** — write it for the model. No `confirmation` flag here; it's auto-detected from the exported function.
- `ai.instructions` = extension-wide guidance (domain facts, output formatting, tool-ordering rules). State concrete constraints, not role-play ("you are a helpful assistant"), and don't assume it's the only extension loaded. For long content, extract to a separate `ai.yaml` at the extension root.

## Evals (`ai.evals[]`) — the regression suite for AI behaviour

Each eval simulates a user prompt and asserts on tool calls / final text; `mocks` stand in for real tool results so runs are deterministic and offline.

```json
{
  "input": "@my-service create an issue 'Fix login' on the web team",
  "mocks": {
    "get-teams": [{ "id": "web", "name": "Web" }],
    "create-issue": "Successfully created issue"
  },
  "expected": [
    { "callsTool": "get-teams" },
    { "callsTool": { "name": "create-issue",
      "arguments": { "title": "Fix login", "teamId": "web" } } },
    { "meetsCriteria": "Includes a markdown link to the created issue" }
  ],
  "usedAsExample": false
}
```

Fields: `input` (prompt, usually `@<name> …`), `mocks` (tool-name → return value), `expected[]` (ALL must pass), `usedAsExample` (default true — set false for assertion-only/edge-case evals so they aren't surfaced as user suggestions).

Expectation matchers:

- `{ "callsTool": "name" }` — tool was invoked.
- `{ "callsTool": { "name", "arguments": { … } } }` — asserts arguments; arg values can nest matchers like `{ "includes": "repo:raycast/extensions" }`.
- `{ "includes": "added" }` — final response contains the substring (case-insensitive).
- `{ "matches": "regex" }` — final response matches.
- `{ "meetsCriteria": "natural-language assertion" }` — LLM-graded.
- `{ "not": { … } }` — negate any matcher (e.g. assert a tool was NOT called).

Run with `npx ray evals` (prints pass/fail per case). Failing evals usually mean improving a tool's `name`/`description` or the `Input` JSDoc. Ship evals covering the happy path, an argument-shape assertion, and a `not` guard.

## `AI.ask` — calling a model *from inside a command* (distinct feature)

```ts
import { AI, environment } from "@raycast/api";
if (!environment.canAccess(AI)) { /* non-Pro path */ }
const answer = await AI.ask("Summarise this", { model: AI.Model["OpenAI_GPT-4o_mini"], creativity: "medium" });

const stream = AI.ask("Write a poem");          // Promise<string> & EventEmitter
stream.on("data", (chunk) => append(chunk));
await stream;
```

Options: `model` (`AI.Model` enum — **don't hardcode bleeding-edge ids, they churn**; default `OpenAI_GPT-4o_mini`), `creativity` (`"none"…"maximum"` or 0–2), `signal`. Always gate on `environment.canAccess(AI)` and respect the rate limits (~10/min, ~100/hr).

`tools` (AI calls your extension) and `AI.ask` (your command calls a model) are independent features — don't conflate them.
