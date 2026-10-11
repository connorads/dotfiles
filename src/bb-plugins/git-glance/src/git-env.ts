// Every variable here redirects git to another repository, index or object store
// (`git rev-parse --local-env-vars`). Git exports some of them to hooks, so a
// process started from a hook, or a test run by one, would otherwise act on the
// hook's repository instead of the one it names with cwd or --git-dir.
const repositoryVars = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX', 'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
];

/** The process environment without repository overrides, plus `extra`. */
export function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of repositoryVars) delete env[name];
  return { ...env, ...extra };
}
