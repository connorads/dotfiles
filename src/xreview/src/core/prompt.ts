// Fill a prompt template's {{SLOT}}s. One pass, so text substituted into a
// slot (a diff, a rubric) is never itself scanned for slots.

import { err, ok, type Result } from "./result.ts";

export interface GuidanceDoc {
  readonly path: string;
  readonly text: string;
}

export interface PromptInputs {
  readonly guidance: readonly GuidanceDoc[];
  readonly rubric: string | null;
  readonly focus: string | null;
  readonly context: string;
}

export const fillTemplate = (template: string, slots: Readonly<Record<string, string>>): Result<string, string> => {
  const missing = new Set<string>();
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, name: string) => {
    const value = slots[name];
    if (value === undefined) {
      missing.add(name);
      return whole;
    }
    return value;
  });
  return missing.size === 0 ? ok(out) : err(`template slot(s) with no value: ${[...missing].join(", ")}`);
};

const guidanceBlock = (docs: readonly GuidanceDoc[]): string =>
  docs.length === 0
    ? "(none)"
    : docs.map((d) => `<file path="${d.path}">\n${d.text.trimEnd()}\n</file>`).join("\n\n");

export const buildPrompt = (template: string, inputs: PromptInputs): Result<string, string> =>
  fillTemplate(template, {
    REPO_GUIDANCE: guidanceBlock(inputs.guidance),
    RUBRIC: inputs.rubric?.trimEnd() || "(none)",
    FOCUS: inputs.focus?.trim() || "(none)",
    CONTEXT: inputs.context,
  });
