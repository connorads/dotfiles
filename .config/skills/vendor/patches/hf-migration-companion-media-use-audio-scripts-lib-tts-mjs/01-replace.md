  pathExists = existsSync,
) {
  if (cmd === "npx" && args[0] === "hyperframes") {
    return { cmd: "hyperframes", args: args.slice(1), opts: { stdio: "ignore", ...opts, shell: false } };
  }
  if (cmd === "npx") throw new Error("Remote executable bootstrap is disabled.");
  if (cmd !== "npx") {
    return { cmd, args, opts: { stdio: "ignore", ...opts } };
  }
