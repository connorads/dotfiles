/** Milliseconds since the Unix epoch. */
export type Instant = number;

/** Nominal typing helper for constrained primitives. */
export type Brand<T, Name extends string> = T & { readonly __brand: Name };

/** Convert unknown failures to useful, stable text. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { readonly message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Truncate long text for widgets and completion messages. */
export function preview(text: string, max = 400): string {
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}
