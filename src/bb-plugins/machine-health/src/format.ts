import type { Gap, Gauge } from './gauge.ts';

/** Whole MB below 1 G, else one decimal of G: `512M`, `2.6G`. */
export function humanMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${Math.trunc(mb)}M`;
}

export function gapText(gap: Gap): string {
  return `${gap.points} ${gap.to}`;
}

/** Chip label: what the number is, how far from the next line, as plain text. */
export function gaugeLabel(gauge: Gauge): string {
  const pressure = gauge.pressure === 4 ? ', pressure critical' : gauge.pressure === 2 ? ', pressure warn' : '';
  return `Memory ${gauge.state}${pressure}: slots ${gauge.slots.pct}% (${gapText(gauge.slots.gap)}), `
    + `segments ${gauge.segments.pct}% (${gapText(gauge.segments.gap)})`;
}

export interface ThreadRow { threadId: string; title: string; mb: number; refusal: string | null }

/** Safe threads first, heaviest first within each group. */
export function rankThreads(rows: ThreadRow[]): ThreadRow[] {
  return [...rows].sort((a, b) => Number(a.refusal !== null) - Number(b.refusal !== null) || b.mb - a.mb);
}

/** The lever: the heaviest idle thread a stop would free, else the app fallback. */
export function actionText(rows: ThreadRow[]): string {
  const first = rankThreads(rows)[0];
  if (!first || first.refusal) return 'No idle agent runtime here. Ending an app frees pages from both arms.';
  return `Hibernate “${first.title}” (${humanMb(first.mb)}) to free its pages from both arms.`;
}
