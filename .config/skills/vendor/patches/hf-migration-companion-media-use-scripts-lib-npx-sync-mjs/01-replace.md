import { isAbsolute } from "node:path";

export function resolveNpxInvocation(argv, opts = {}, _platform = process.platform, env = process.env) {
  if (argv[0] !== "hyperframes") throw new Error("Remote executable bootstrap is disabled.");
  const entry = env.HYPERFRAMES_CLI_ENTRY;
  if (entry && isAbsolute(entry)) {
    return {
      cmd: process.execPath,
      args: [entry, ...argv.slice(1).map(String)],
      opts: { stdio: "ignore", windowsHide: true, ...opts, shell: false },
    };
  }
  return { cmd: "hyperframes", args: argv.slice(1).map(String), opts: { stdio: "ignore", ...opts, shell: false } };
}
