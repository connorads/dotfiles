// Pure: cut one file's patch to a reading budget without breaking it, so BB's
// diff component still parses the part it shows.

export interface Limits { maxLines: number; maxChars: number }

/** First render of one file: enough to read, small enough to scroll past. */
export const displayLimits: Limits = { maxLines: 1_000, maxChars: 200_000 };
/** "Show all" on one file; past this a terminal or editor is the better tool. */
export const expandedLimits: Limits = { maxLines: 25_000, maxChars: 2_000_000 };

export interface Truncated {
  patch: string;
  /** Hunk lines kept and in total; `shownLines < totalLines` means the patch was cut. */
  shownLines: number;
  totalLines: number;
}

const hunkHeader = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** A hunk header whose counts match the body lines kept. */
function recount(header: string, body: readonly string[]): string {
  const match = hunkHeader.exec(header);
  if (!match) return header;
  let before = 0, after = 0;
  for (const line of body) {
    if (line.startsWith('-')) before++;
    else if (line.startsWith('+')) after++;
    else if (!line.startsWith('\\')) { before++; after++; }
  }
  return `@@ -${match[1]},${before} +${match[2]},${after} @@${match[3]}`;
}

/**
 * Keep whole hunks while they fit the limits. When even the first hunk does
 * not fit, keep its head and rewrite its header counts to match.
 */
export function truncatePatch(patch: string, limits: Limits): Truncated {
  const trailingNewline = patch.endsWith('\n');
  const lines = (trailingNewline ? patch.slice(0, -1) : patch).split('\n');
  const firstHunk = lines.findIndex(line => line.startsWith('@@'));
  if (firstHunk < 0) return { patch, shownLines: 0, totalLines: 0 };
  const header = lines.slice(0, firstHunk);
  const hunks: string[][] = [];
  for (const line of lines.slice(firstHunk)) {
    if (line.startsWith('@@')) hunks.push([line]); else hunks[hunks.length - 1]!.push(line);
  }
  const totalLines = hunks.reduce((sum, hunk) => sum + hunk.length - 1, 0);
  let chars = header.reduce((sum, line) => sum + line.length + 1, 0);
  if (totalLines <= limits.maxLines && patch.length <= limits.maxChars) return { patch, shownLines: totalLines, totalLines };

  const kept: string[] = [...header];
  let shownLines = 0;
  for (const hunk of hunks) {
    const size = hunk.reduce((sum, line) => sum + line.length + 1, 0);
    if (shownLines + hunk.length - 1 <= limits.maxLines && chars + size <= limits.maxChars) {
      kept.push(...hunk);
      shownLines += hunk.length - 1;
      chars += size;
      continue;
    }
    if (shownLines === 0) {
      const body: string[] = [];
      for (const line of hunk.slice(1)) {
        if (body.length >= limits.maxLines || (body.length > 0 && chars + line.length + 1 > limits.maxChars)) break;
        body.push(line);
        chars += line.length + 1;
      }
      kept.push(recount(hunk[0]!, body), ...body);
      shownLines = body.length;
    }
    break;
  }
  return { patch: `${kept.join('\n')}\n`, shownLines, totalLines };
}
