async function confirmBootstrap(packageSpecs) {
  if (process.env[BOOTSTRAP_CONFIRM_ENV] === "1") return;

  const installLine = `npm install --ignore-scripts --no-save ${packageSpecs.map(shellQuote).join(" ")}`;
  if (!process.stdin.isTTY) {
    throw new Error(
      [
        "Required helper package(s) are missing.",
        "To allow a one-time temporary dependency bootstrap for this run, set:",
        `  ${BOOTSTRAP_CONFIRM_ENV}=1`,
        "The bootstrap command will be:",
        `  ${installLine}`,
      ].join("\n"),
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      [
        "HyperFrames helper package(s) are missing.",
        `Run a temporary install with lifecycle scripts disabled?`,
        `  ${installLine}`,
        "Proceed? [y/N] ",
      ].join("\n"),
    );
    if (!/^(y|yes)$/i.test(answer.trim())) {
      throw new Error("Dependency bootstrap cancelled.");
    }
  } finally {
    rl.close();
  }
}
