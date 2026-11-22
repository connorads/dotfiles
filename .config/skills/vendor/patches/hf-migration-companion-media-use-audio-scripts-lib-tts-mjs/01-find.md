function launchingCliCommand(cmd, args, env = process.env) {
  if (cmd !== "npx" || args[0] !== "hyperframes") return null;
  const entry = env.HYPERFRAMES_CLI_ENTRY;
  if (!entry || !isAbsolute(entry)) throw new Error(MISSING_CLI_MESSAGE);
  return { cmd: process.execPath, args: [entry, ...args.slice(1).map((arg) => String(arg))] };
}

export function resolveSpawnCommand(
  cmd,
  args,
  opts = {},
  platform = process.platform,
  env = process.env,
  pathExists = existsSync,
) {
  const cli = launchingCliCommand(cmd, args, env);
  if (cli) return { ...cli, opts: { stdio: "ignore", windowsHide: true, ...opts } };
  if (cmd !== "npx" || platform !== "win32") {
    return { cmd, args, opts: { stdio: "ignore", ...opts } };
  }
