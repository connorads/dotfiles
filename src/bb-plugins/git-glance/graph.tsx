import type { GraphRow } from './src/graph.ts';

export const rowHeight = 32;
const laneGap = 14;
const inset = 10;
const mid = rowHeight / 2;
export const laneX = (lane: number) => inset + lane * laneGap;
export const graphWidth = (lanes: number) => inset * 2 + (Math.max(1, lanes) - 1) * laneGap;
export const laneColour = (lane: number) => `var(--gg-lane-${lane % 6})`;

function curve(from: number, y1: number, to: number, y2: number) {
  const x1 = laneX(from), x2 = laneX(to);
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  const bend = (y2 - y1) * 0.6;
  return `M${x1} ${y1}C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`;
}

export function GraphCell({ row, width, head, unpushed, merge }: {
  row: GraphRow; width: number; head: boolean; unpushed: boolean; merge: boolean;
}) {
  const x = laneX(row.lane);
  const colour = laneColour(row.lane);
  return <svg className="gg-graph" width={width} height={rowHeight} viewBox={`0 0 ${width} ${rowHeight}`} aria-hidden>
    {row.through.map(lane => <path key={`t${lane}`} d={`M${laneX(lane)} 0V${rowHeight}`} stroke={laneColour(lane)} />)}
    {row.incoming.map(s => <path key={`i${s.from}`} d={curve(s.from, 0, s.to, mid)} stroke={laneColour(s.from)} />)}
    {row.outgoing.map(s => <path key={`o${s.to}`} d={curve(s.from, mid, s.to, rowHeight)} stroke={laneColour(s.to)} />)}
    {head && <circle cx={x} cy={mid} r={8} className="gg-halo" fill={colour} />}
    <circle cx={x} cy={mid} r={merge ? 3.25 : head ? 5 : 4.25} className="gg-node" data-unpushed={unpushed || undefined}
      stroke={colour} fill={unpushed || head ? colour : 'var(--popover)'} />
  </svg>;
}
