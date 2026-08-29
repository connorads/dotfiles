// The Destination port and its dispatcher.
//
// Delivery either succeeds or names why it did not, and the caller maps that
// onto the shared exit contract. Nothing here touches the store: `sent` is
// appended by the caller, and only after a success, so a refused delivery
// leaves both spool and draft exactly as they were.

import type { DestinationKind } from "../../core/args.ts";
import type { Result } from "../../core/result.ts";
import { deliverToAgent } from "./agent.ts";
import { deliverToClipboard } from "./clipboard.ts";
import { deliverToFile } from "./file.ts";

export interface DeliveryRequest {
  readonly kind: DestinationKind;
  readonly markdown: string;
  /** tmux pane for the agent destination. */
  readonly pane: string | null;
  /** Output path for the file destination. */
  readonly file: string | null;
}

export type DeliveryError =
  /** No target, a pane that is gone, or a path that cannot be written. */
  | { readonly kind: "unresolvable"; readonly message: string }
  /** The pane is waiting on a human - an approval or trust prompt. */
  | { readonly kind: "refused"; readonly message: string }
  /** Delivered, but the agent never started on it. */
  | { readonly kind: "stall"; readonly message: string };

/** How the delivery is recorded in the log, e.g. `agent:%12`. */
export type Delivery = { readonly destination: string };

export type Destination = (
  request: DeliveryRequest,
) => Promise<Result<Delivery, DeliveryError>>;

export const deliver: Destination = async (request) => {
  switch (request.kind) {
    case "agent":
      return deliverToAgent(request);
    case "clipboard":
      return deliverToClipboard(request);
    case "file":
      return deliverToFile(request);
  }
};
