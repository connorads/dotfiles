// Lane layout for a commit graph drawn one row per commit, newest first.
// Each lane holds the sha it expects next; a commit takes the lane expecting it,
// hands that lane to its first parent and opens or joins lanes for other parents.

export interface GraphInput { sha: string; parents: readonly string[] }
export interface Segment {
  /** Lane at the top or middle of the row. */
  from: number;
  /** Lane at the middle or bottom of the row. */
  to: number;
}
export interface GraphRow {
  lane: number;
  /** Lines from the row's top edge into the commit node. */
  incoming: Segment[];
  /** Lines from the commit node to the row's bottom edge. */
  outgoing: Segment[];
  /** Lanes that pass the row without touching the node. */
  through: number[];
  /** Lanes in use at either edge of the row. */
  width: number;
}

export function layoutGraph(commits: readonly GraphInput[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const free = () => { const index = lanes.indexOf(null); return index < 0 ? lanes.length : index; };
  return commits.map(commit => {
    const before = [...lanes];
    let lane = lanes.indexOf(commit.sha);
    if (lane < 0) lane = free();
    const incoming: Segment[] = [];
    before.forEach((sha, index) => {
      if (sha !== commit.sha) return;
      incoming.push({ from: index, to: lane });
      if (index !== lane) lanes[index] = null;
    });
    lanes[lane] = commit.parents[0] ?? null;
    const outgoing: Segment[] = commit.parents[0] ? [{ from: lane, to: lane }] : [];
    for (const parent of commit.parents.slice(1)) {
      const existing = lanes.indexOf(parent);
      const target = existing < 0 ? free() : existing;
      lanes[target] = parent;
      outgoing.push({ from: lane, to: target });
    }
    const through = before.flatMap((sha, index) => sha && sha !== commit.sha && lanes[index] === sha ? [index] : []);
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    const used = [lane, ...through, ...outgoing.map(segment => segment.to), ...incoming.map(segment => segment.from)];
    return { lane, incoming, outgoing, through, width: Math.max(...used) + 1 };
  });
}
