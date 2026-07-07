import type { Model, ModelRegistry, ThinkingLevel } from "@earendil-works/pi-coding-agent";

/**
 * Resolve an `agent({model})` string against the live registry: exact id match
 * first, then `provider/id`, then display name. The package's own resolver is
 * not root-exported (deep imports are blocked by its exports map), so this
 * small matcher over `getAvailable()` is the local equivalent.
 */
export function resolveRequestedModel(registry: ModelRegistry, requested: string): Model {
  const available = registry.getAvailable();
  const byId = available.find((model) => model.id === requested);
  if (byId) return byId;

  const slash = requested.indexOf("/");
  if (slash > 0 && slash < requested.length - 1) {
    const byRef = registry.find(requested.slice(0, slash), requested.slice(slash + 1));
    if (byRef) return byRef;
  }

  const byName = available.find((model) => model.name === requested);
  if (byName) return byName;

  const known = available
    .slice(0, 20)
    .map((model) => `${model.provider}/${model.id}`)
    .join(", ");
  throw new Error(`Unknown agent model: ${requested}${known ? `. Available: ${known}` : ""}`);
}

/** Map an `agent({effort})` option to a Pi thinking level. */
export function thinkingLevelForEffort(effort: string): ThinkingLevel {
  switch (effort) {
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return effort;
    case "max":
      return "xhigh";
    default:
      throw new Error(`Unknown agent effort: ${effort} (use low, medium, high, xhigh, or max)`);
  }
}
