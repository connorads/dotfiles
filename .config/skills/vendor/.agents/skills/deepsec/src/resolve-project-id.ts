import path from "node:path";
import { findProject, getConfig, getConfigPath } from "@deepsec/core";

// Strict allowlist for project ids. Catches `..`, path separators, shell
// metacharacters, and whitespace in one place — every CLI entry point and
// every config-supplied id flows through here, so downstream callers
// (path joins, sandbox `sh -c` interpolation, git commit messages) can
// treat the value as opaque.
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function validateProjectId(id: string): string {
  if (!PROJECT_ID_RE.test(id)) {
    throw new Error(
      `Invalid project id ${JSON.stringify(id)}: must match ${PROJECT_ID_RE} ` +
        `(letters, digits, '.', '_', '-'; up to 64 chars; must not start with a separator).`,
    );
  }
  return id;
}

/**
 * Resolve a project id from CLI input or the loaded config.
 *
 * Precedence:
 *   1. The `--project-id` value the user passed (always wins).
 *   2. The single entry of `projects[]` if the config has exactly one.
 *
 * Throws with actionable guidance when neither path resolves to a unique
 * project — i.e. config has zero projects, or has multiple and the user
 * didn't disambiguate.
 */
export function resolveProjectId(provided: string | undefined): string {
  if (provided) return validateProjectId(provided);

  const config = getConfig();
  const projects = config?.projects ?? [];

  if (projects.length === 1) return validateProjectId(projects[0].id);

  if (projects.length === 0) {
    throw new Error(
      `No --project-id specified and no projects found in deepsec.config.ts.\n` +
        `  Run \`deepsec init\` to scaffold a workspace, or add an entry to\n` +
        `  the projects[] array in your existing deepsec.config.ts.`,
    );
  }

  const ids = projects.map((p) => p.id).join(", ");
  throw new Error(
    `Multiple projects in deepsec.config.ts: ${ids}.\n` + `  Pass --project-id <id> to pick one.`,
  );
}

export { validateProjectId };

/**
 * Resolve a project + root for direct-invocation flows (`process --diff`,
 * `process --files`). Unlike `resolveProjectId`, this never errors when
 * the project is missing — direct invocation is intended to "just work"
 * in a freshly-checked-out repo with no prior deepsec setup.
 *
 * Resolution rules:
 *   1. If `--project-id` is given:
 *      a. Look it up in deepsec.config.ts → use its declared root.
 *      b. If not found in config, use `--root`, or `cwd`. Project gets
 *         auto-created on disk via `ensureProject()` at the call site.
 *   2. If `--project-id` is omitted:
 *      a. Single project in config → use it.
 *      b. No projects in config → derive id from `--root` or `cwd`
 *         basename (sanitized).
 *      c. Multiple projects in config → error (ambiguous).
 *
 * Returns the resolved id + absolute root path, plus a flag indicating
 * whether this is a fresh (auto-created) project so the CLI can print
 * a one-line notice.
 */
export function resolveProjectIdForDirect(
  providedId: string | undefined,
  rootOverride: string | undefined,
): { projectId: string; rootPath: string; autoCreated: boolean } {
  const config = getConfig();
  const configPath = getConfigPath();
  const projects = config?.projects ?? [];
  const configDir = configPath ? path.dirname(configPath) : process.cwd();

  if (providedId) {
    const id = validateProjectId(providedId);
    const declared = findProject(id);
    if (declared && !rootOverride) {
      return {
        projectId: id,
        rootPath: path.resolve(configDir, declared.root),
        autoCreated: false,
      };
    }
    const rootPath = path.resolve(rootOverride ?? configDir);
    return { projectId: id, rootPath, autoCreated: !declared };
  }

  if (projects.length === 1) {
    return {
      projectId: validateProjectId(projects[0].id),
      rootPath: path.resolve(configDir, projects[0].root),
      autoCreated: false,
    };
  }
  if (projects.length > 1) {
    const ids = projects.map((p) => p.id).join(", ");
    throw new Error(
      `Multiple projects in deepsec.config.ts: ${ids}.\n` + `  Pass --project-id <id> to pick one.`,
    );
  }

  // No config or zero projects — derive id from the root path's basename.
  const rootPath = path.resolve(rootOverride ?? process.cwd());
  const baseName = path.basename(rootPath);
  const sanitized = baseName.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64) || "deepsec-target";
  // basename may start with a dot (".deepsec") which validateProjectId
  // rejects. Strip leading non-alphanumerics.
  const safe = sanitized.replace(/^[^A-Za-z0-9]+/, "") || "deepsec-target";
  return { projectId: validateProjectId(safe), rootPath, autoCreated: true };
}
