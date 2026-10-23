import { fileURLToPath } from "node:url";

// The stub stands in for `hyperframes transcribe <in> --dir <dir> ...`: it records its args,
// writes the CLI's flat array and prints the CLI's --json line naming `cliEngine`.
function runScript(engine, cliEngine) {
