// Delivery to the system clipboard, for pasting somewhere annotate cannot
// reach - a browser, a chat window, a PR description.

import { err, ok, type Result } from "../../core/result.ts";
import type { Delivery, DeliveryError, DeliveryRequest } from "./index.ts";

/** First one that exists wins: macOS, then Wayland, then X11. */
const CANDIDATES: readonly (readonly string[])[] = [
  ["pbcopy"],
  ["wl-copy"],
  ["xclip", "-selection", "clipboard"],
  ["xsel", "--clipboard", "--input"],
];

export const deliverToClipboard = async (
  request: DeliveryRequest,
): Promise<Result<Delivery, DeliveryError>> => {
  for (const argv of CANDIDATES) {
    try {
      const child = Bun.spawn([...argv], {
        stdin: new TextEncoder().encode(request.markdown),
        stdout: "ignore",
        stderr: "ignore",
      });
      const code = await child.exited;
      if (code === 0) return ok({ destination: "clipboard" });
    } catch {
      // Not installed. Try the next one rather than failing the delivery.
      continue;
    }
  }
  return err({ kind: "unresolvable", message: "no clipboard command found" });
};
