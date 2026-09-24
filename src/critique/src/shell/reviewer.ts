// The reviewer port: run one headless agent on a prompt, read-only, and hand
// back its structured answer unparsed. core/parse.ts decides whether it holds.

import type { Result } from "../core/result.ts";
import type { ReviewerSpec } from "../core/types.ts";

export interface ReviewRequest {
  readonly spec: ReviewerSpec;
  readonly prompt: string;
  /** Repository the reviewer inspects; its cwd. */
  readonly cwd: string;
  /** Private scratch dir for this reviewer's schema and output files. */
  readonly workdir: string;
}

export type RunReviewer = (req: ReviewRequest) => Promise<Result<unknown, string>>;
