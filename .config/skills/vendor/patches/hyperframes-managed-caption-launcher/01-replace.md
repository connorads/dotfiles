// Resolve CLI ownership once for matting, transcription, and shell rendering.
const fs = require("node:fs");
const path = require("node:path");
function hfCli() {
  return path.resolve(__dirname, "../../hyperframes/scripts/plugin-cli.mjs");
}
/** The browser the CLI launches (`hyperframes browser path`), so these scripts never pick their own; without a CLI,
 * the system Chrome they used before. */
function hfBrowser() {
  const { execFileSync } = require("node:child_process");
  const asks = [
    () => [process.execPath, [hfCli(), "browser", "path"]],
    () => ["hyperframes", ["browser", "path"]],
  ];
  for (const ask of asks) {
    try {
      const [command, args] = ask();
      const out = execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const found = out.trim().split("\n").pop();
      if (found && fs.existsSync(found)) return found;
    } catch {}
  }
  const chrome =
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/google-chrome";
  return fs.existsSync(chrome) ? chrome : undefined;
}
module.exports = { hfCli, hfBrowser };
if (require.main === module) console.log(hfCli());
