// Rows of `skl list --folders`, the same feed the tmux picker pipes into fzf.
// skl owns discovery, config and payload filters; this module only reads its
// line format back: `<ref>  <description>`, where a folder row's ref ends in
// `/` and its rest is `(count)`.

export type Row =
  | { readonly kind: 'folder'; readonly ref: string; readonly source: string; readonly count: number }
  | { readonly kind: 'skill'; readonly ref: string; readonly source: string; readonly name: string; readonly description: string };

export function parseListLines(lines: readonly string[]): Row[] {
  const rows: Row[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') continue;
    const [ref = '', ...rest] = line.split(/\s+/);
    const tail = line.slice(ref.length).trim();
    const slash = ref.indexOf('/');
    if (slash <= 0) continue;
    const source = ref.slice(0, slash);
    if (ref.endsWith('/')) {
      const count = Number(/^\((\d+)\)$/.exec(rest.join(' '))?.[1] ?? Number.NaN);
      rows.push({ kind: 'folder', ref, source, count: Number.isFinite(count) ? count : 0 });
    } else {
      rows.push({ kind: 'skill', ref, source, name: ref.slice(slash + 1), description: tail });
    }
  }
  return rows;
}

/**
 * Fuzzy filter scoped to the ref, like the picker's `fzf --nth=1`: matching the
 * hidden description would drag unrelated skills under the wrong folder. Each
 * whitespace-separated term must match as a case-insensitive subsequence.
 * Rows are ranked like fzf: a loose subsequence (`prd` in
 * `private/reconcile-shared-expenses`) must not bury `personal/prd`, above all
 * in the capped mention menu. Equal scores keep list order.
 */
export function filterRows(rows: readonly Row[], query: string): Row[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...rows];
  const scored: { row: Row; score: number; index: number }[] = [];
  rows.forEach((row, index) => {
    let score = 0;
    for (const term of terms) {
      const termScore = matchScore(term, row);
      if (termScore === 0) return;
      score += termScore;
    }
    scored.push({ row, score, index });
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.row);
}

/** 0 for no match; otherwise higher for tighter matches on the skill (or folder) name. */
function matchScore(term: string, row: Row): number {
  const ref = row.ref.toLowerCase();
  const name = (row.kind === 'folder' ? row.source : row.name).toLowerCase();
  if (name === term) return 100;
  if (name.startsWith(term)) return 80;
  const at = ref.indexOf(term);
  if (at === 0 || (at > 0 && /[/\-_.]/.test(ref[at - 1] ?? ''))) return 60;
  if (at > 0) return 40;
  const span = subsequenceSpan(term, ref);
  return span === null ? 0 : Math.max(1, 20 - (span - term.length));
}

/** Length of the shortest window of `haystack` holding `needle` as a subsequence, or null. */
function subsequenceSpan(needle: string, haystack: string): number | null {
  let best: number | null = null;
  for (let start = haystack.indexOf(needle[0] ?? ''); start !== -1; start = haystack.indexOf(needle[0] ?? '', start + 1)) {
    let at = start;
    for (const char of needle.slice(1)) {
      at = haystack.indexOf(char, at + 1);
      if (at === -1) return best;
    }
    const span = at - start + 1;
    if (best === null || span < best) best = span;
  }
  return best;
}

/**
 * Expand folder refs to their member skill refs, dropping duplicates. A ref
 * that matches nothing lands in `missing`: skl fails a whole batch on one bad
 * ref, and so does the caller.
 */
export function expandRefs(refs: readonly string[], rows: readonly Row[]): { refs: string[]; missing: string[] } {
  const out: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const members = ref.endsWith('/')
      ? rows.filter(row => row.kind === 'skill' && row.source === ref.slice(0, -1)).map(row => row.ref)
      : rows.some(row => row.kind === 'skill' && row.ref === ref) ? [ref] : [];
    if (members.length === 0) missing.push(ref);
    for (const member of members) {
      if (seen.has(member)) continue;
      seen.add(member);
      out.push(member);
    }
  }
  return { refs: out, missing };
}

/** Folder refs in a selection: installing one copies a whole group, so it needs confirming. */
export function groupRefs(refs: readonly string[]): string[] {
  return refs.filter(ref => ref.endsWith('/'));
}
