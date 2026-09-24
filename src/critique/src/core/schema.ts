// The JSON Schema both reviewers are held to (codex --output-schema, claude
// --json-schema). OpenAI's strict mode requires every property to be listed
// in `required`, so an absent location is expressed as null, not omitted.

export const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "summary", "findings", "next_steps"],
  properties: {
    verdict: { type: "string", enum: ["approve", "needs-attention"] },
    summary: { type: "string", minLength: 1 },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "title", "body", "recommendation", "file", "line_start", "line_end", "confidence"],
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          title: { type: "string", minLength: 1 },
          body: { type: "string", minLength: 1 },
          recommendation: { type: "string" },
          file: { type: ["string", "null"] },
          line_start: { type: ["integer", "null"], minimum: 1 },
          line_end: { type: ["integer", "null"], minimum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    next_steps: { type: "array", items: { type: "string", minLength: 1 } },
  },
} as const;
