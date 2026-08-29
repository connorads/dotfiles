// Delivery to a file, for a draft that wants keeping or reviewing elsewhere.
// Also what the over-the-cap message points at: `annotate render > review.md`.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { err, ok, type Result } from "../../core/result.ts";
import type { Delivery, DeliveryError, DeliveryRequest } from "./index.ts";

export const deliverToFile = async (
  request: DeliveryRequest,
): Promise<Result<Delivery, DeliveryError>> => {
  const path = request.file;
  if (path === null) {
    return err({ kind: "unresolvable", message: "no output path - name one with --file PATH" });
  }
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, request.markdown, "utf8");
    return ok({ destination: path });
  } catch (cause) {
    return err({
      kind: "unresolvable",
      message: `cannot write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
};
