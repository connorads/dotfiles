// Caption callers execute this shared installed-CLI launcher through Node.
const path = require("node:path");
function hfCli() {
  return path.resolve(__dirname, "../../hyperframes/scripts/plugin-cli.mjs");
}
module.exports = { hfCli };
if (require.main === module) console.log(hfCli());
