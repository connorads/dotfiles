// pi extension shell: wires the pure guard core into the tool_call event.
// Auto-discovered from ~/.pi/agent/extensions/ via the package.json "pi"
// manifest - no settings.json entry needed.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";

import { blockReason } from "./guard.ts";

export default function extension(pi: ExtensionAPI) {
  const home = homedir();
  pi.on("tool_call", (event) => {
    const reason = blockReason(event.toolName, event.input, home);
    return reason ? { block: true, reason } : undefined;
  });
}
