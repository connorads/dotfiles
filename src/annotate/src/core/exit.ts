// Outcomes and the exit code each maps to.
//
// The contract is `agent`'s, so a caller scripting both reads one set of
// codes: 0 ok · 1 store/IO failure · 2 usage · 3 source or target
// unresolvable · 4 delivery refused · 5 delivery stall.
//
// Every benign no-op is 0 - an empty selection, an empty spool, an editor
// quit without saving. None of those is a failure, and a capture key that
// beeped on an empty selection would be noise in the review flow.

export type Outcome =
  /** Did what was asked, including when there was nothing to do. */
  | { readonly kind: "ok"; readonly message?: string }
  /** The store could not be read or written. */
  | { readonly kind: "store"; readonly message: string }
  /** Bad arguments. */
  | { readonly kind: "usage"; readonly message: string }
  /** A source or a target pane could not be resolved. */
  | { readonly kind: "unresolvable"; readonly message: string }
  /** The target refused delivery - typically a pane waiting on an answer. */
  | { readonly kind: "refused"; readonly message: string }
  /** Delivery was accepted but the agent never started on it. */
  | { readonly kind: "stall"; readonly message: string };

export const exitCodeFor = (outcome: Outcome): number => {
  switch (outcome.kind) {
    case "ok":
      return 0;
    case "store":
      return 1;
    case "usage":
      return 2;
    case "unresolvable":
      return 3;
    case "refused":
      return 4;
    case "stall":
      return 5;
  }
};

/** Whether the outcome's message belongs on stderr rather than stdout. */
export const isFailure = (outcome: Outcome): boolean => outcome.kind !== "ok";
