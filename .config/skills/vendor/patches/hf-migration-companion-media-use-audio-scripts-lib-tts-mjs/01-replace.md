function launchingCliCommand(cmd, args, env = process.env) {
  if (cmd !== "npx" || args[0] !== "hyperframes") return null;
  const entry = env.HYPERFRAMES_CLI_ENTRY;
  if (entry && isAbsolute(entry)) {
    return { cmd: process.execPath, args: [entry, ...args.slice(1).map((arg) => String(arg))] };
  }
  return { cmd: "hyperframes", args: args.slice(1).map((arg) => String(arg)) };
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
  if (cli) return { ...cli, opts: { stdio: "ignore", windowsHide: true, ...opts, shell: false } };
  if (cmd === "npx") throw new Error("Remote executable bootstrap is disabled.");
  if (cmd !== "npx") {
    return { cmd, args, opts: { stdio: "ignore", ...opts } };
  }
