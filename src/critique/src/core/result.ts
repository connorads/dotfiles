// Explicit success/failure values for the pure core. No exceptions below the
// imperative shell - every fallible core function returns a Result.
//
// Lifted from ~/src/skl/src/core/result.ts. Duplicated rather than shared: the
// two projects have no build step and no package linking between them, and a
// ten-line type is cheaper to copy than to couple.

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
