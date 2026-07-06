/** Explicit success/failure values for the workflow core. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Build a successful result. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Build a failed result. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Exhaustiveness helper for discriminated unions. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
