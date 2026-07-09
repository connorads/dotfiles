export const WORKFLOW_TOOL_NAME = "workflow";
const STRUCTURED_OUTPUT_TOOL_NAME = "structured_output";

export interface WorkflowToolPolicy {
  readonly toolAllowlist: readonly string[];
  readonly excludedTools: readonly string[];
}

const DEFAULT_EXCLUDED_TOOLS = [WORKFLOW_TOOL_NAME] as const;

/** Derive the subagent tool policy from the active parent Pi tool set. */
export function deriveWorkflowToolPolicy(activeTools: readonly string[]): WorkflowToolPolicy {
  const excluded = new Set<string>(DEFAULT_EXCLUDED_TOOLS);
  const seen = new Set<string>();
  const toolAllowlist: string[] = [];
  for (const tool of activeTools) {
    const name = tool.trim();
    if (!name || excluded.has(name) || seen.has(name)) continue;
    seen.add(name);
    toolAllowlist.push(name);
  }
  return {
    toolAllowlist,
    excludedTools: [...DEFAULT_EXCLUDED_TOOLS],
  };
}

/** Tools passed to a concrete Pi subagent session. */
export function toolsForSubagent(policy: WorkflowToolPolicy, structured: boolean): string[] {
  const names = [...policy.toolAllowlist];
  if (structured && !names.includes(STRUCTURED_OUTPUT_TOOL_NAME)) names.push(STRUCTURED_OUTPUT_TOOL_NAME);
  return names;
}
