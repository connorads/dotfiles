export function resolveNpxInvocation(argv, opts = {}) {
  const args = argv.filter((arg, index) => !(index === 0 && (arg === "--yes" || arg === "-y")));
  if (!/^hyperframes(?:@[^\s]+)?$/.test(args[0] ?? ""))
    throw new Error("Only the managed HyperFrames CLI may be launched by this helper.");
  return { cmd: "hyperframes", args: args.slice(1), opts: { stdio: "ignore", ...opts, shell: false } };
}
