import type { Brand } from "./prelude.ts";
import { err, ok, type Result } from "./result.ts";

export const WORKFLOW_TOOL_NAME = "workflow";
export const MAX_WORKFLOW_OBJECTIVE_CHARS = 12_000;

/** User objective accepted by `/workflow` and `/workflows start`. */
export type WorkflowObjective = Brand<string, "WorkflowObjective">;

/** Effects needed to ask Pi to create and launch an inline workflow. */
export interface WorkflowStarterRuntime {
  activateTool(name: string): void;
  sendFollowUp(message: string): void;
}

/** Immediate result after a workflow starter command injects the follow-up turn. */
export interface WorkflowStart {
  readonly objective: WorkflowObjective;
  readonly prompt: string;
  readonly summary: string;
}

export class InvalidWorkflowStartCommand extends Error {
  readonly _tag = "InvalidWorkflowStartCommand";
}

/** Parse the free-form objective supplied to `/workflow`. */
export function parseWorkflowObjective(input: string): Result<WorkflowObjective, InvalidWorkflowStartCommand> {
  const objective = input.trim();
  if (objective.length === 0) {
    return err(new InvalidWorkflowStartCommand("Usage: /workflow <objective>"));
  }
  if (objective.length > MAX_WORKFLOW_OBJECTIVE_CHARS) {
    return err(new InvalidWorkflowStartCommand(`Workflow objective exceeds ${MAX_WORKFLOW_OBJECTIVE_CHARS} characters`));
  }
  const hidden = firstHiddenControl(objective);
  if (hidden !== undefined) {
    return err(new InvalidWorkflowStartCommand(`Workflow objective contains hidden control character 0x${hidden.toString(16)}`));
  }
  // SAFETY: parseWorkflowObjective is the only constructor for WorkflowObjective.
  return ok(objective as WorkflowObjective);
}

/** Ask the model to generate an inline script and call the workflow tool. */
export function startWorkflowFromCommand(
  args: string,
  runtime: WorkflowStarterRuntime,
): Result<WorkflowStart, InvalidWorkflowStartCommand> {
  const objective = parseWorkflowObjective(args);
  if (!objective.ok) return objective;

  const prompt = renderWorkflowStartPrompt(objective.value);
  runtime.activateTool(WORKFLOW_TOOL_NAME);
  runtime.sendFollowUp(prompt);

  return ok({
    objective: objective.value,
    prompt,
    summary: "Workflow starter sent. Pi will draft an inline script and call the workflow tool.",
  });
}

/** Render the model-facing starter instruction injected by `/workflow`. */
export function renderWorkflowStartPrompt(objective: WorkflowObjective): string {
  return [
    "Start a Pi dynamic workflow for the objective below.",
    "",
    "Create an inline workflow script and call the `workflow` tool exactly once.",
    "Use the tool's `script` input. Do not use `name` or `scriptPath`.",
    "Do not answer in prose before the tool call. If you cannot launch a workflow, explain the blocker briefly.",
    "",
    "Workflow script requirements:",
    "- Start with `export const meta = { ... }`.",
    "- Include a concise kebab-case `meta.name` and a short `meta.description`.",
    "- Use the Pi workflow DSL helpers available in script scope: `agent`, `parallel`, `pipeline`, `phase`, `log`, `budget`, and child `workflow` calls.",
    "- Prefer a small number of meaningful phases and agent calls.",
    "- Use `parallel` for independent branches and `pipeline` for staged item processing.",
    "- Return a JSON-serialisable result that summarises what happened.",
    "",
    "Objective:",
    objective,
  ].join("\n");
}

function firstHiddenControl(source: string): number | undefined {
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f)) return code;
  }
  return undefined;
}
