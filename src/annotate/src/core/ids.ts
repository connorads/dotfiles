// Excerpt identifiers: a millisecond timestamp in base36, zero-padded to a
// fixed width, then a random suffix. Fixed width is what makes plain string
// comparison agree with time order, which `renderedThrough` relies on when the
// excerpt it names has since been dropped from the spool.
//
// Two excerpts stashed inside the same millisecond by different processes are
// ordered by their random suffix rather than by arrival. That is why the
// primary "newer than" rule in draft.ts is spool position, not this ordering -
// lexical compare is only the fallback.

/** Width of the base36 timestamp. 8 digits covers to the year 61417. */
const TS_WIDTH = 8;

/** Ambient values an id needs, injected so the core stays pure. */
export interface IdSeed {
  /** Milliseconds since the epoch. */
  readonly now: number;
  /** A random value in [0, 1). */
  readonly random: number;
}

export const excerptId = (seed: IdSeed): string => {
  const stamp = Math.floor(seed.now).toString(36).padStart(TS_WIDTH, "0");
  const suffix = Math.floor(seed.random * 0x100000000)
    .toString(36)
    .padStart(7, "0");
  return `${stamp}-${suffix}`;
};

/** ISO-8601 UTC, the timestamp format every record in the log carries. */
export const isoTimestamp = (now: number): string => new Date(now).toISOString();
