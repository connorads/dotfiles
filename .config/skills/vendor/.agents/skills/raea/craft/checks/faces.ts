// A worked check for a note that says "the desks face the wrong way" (docs/direction.feature DR6): each part of a kind
// faces what it serves, the nearest of it, on every frame.
//
// Its values, the kinds as raea/check's `named` reads them: `what`, the parts that face; `toward`, what they face (a
// desk its chair), or `away`, what they turn their backs to (a desk the wall); `front`, the model's own front, "+z"
// (the default), "-z", "+x" or "-x", until DR11 measures it from the model; `within`, how far off it may be, in
// degrees (default 30). Only the turn about the up axis counts.
//
//   asks: [{ text: "every desk faces its chair", check: "../../checks/faces.ts", values: { what: "desk", toward: "chair" } }]
//
// Its cheats, each failed: one desk turned round; the desks renamed, or the chairs gone, so there is nothing to face.
import { check, found, named, turned, type Part } from "raea/check";

const AXES: Record<string, number[]> = { "+z": [0, 0, 1], "-z": [0, 0, -1], "+x": [1, 0, 0], "-x": [-1, 0, 0] };
const centre = (p: Part) => (p.min && p.max ? [0, 1, 2].map((k) => (p.min![k] + p.max![k]) / 2) : p.at);

export default check(
  { id: "faces", text: "each part faces what it serves" },
  (world, _frame, values, memo) => {
    const axis = AXES[String(values.front ?? "+z")];
    if (!axis) throw new Error(`front is "+z", "-z", "+x" or "-x", not "${values.front}"`);
    const away = values.toward == null;
    const parts = world.find({ with: ["Part"] });
    const part = (id: number) => world.component<Part>(id, "Part")!;
    const what = parts.filter((p) => named(world, p, String(values.what)));
    const goals = parts.filter((p) => !what.includes(p) && named(world, p, String(away ? values.away : values.toward)));
    memo.what ||= what.length > 0;
    memo.goals ||= goals.length > 0;
    const within = Number(values.within ?? 30);
    for (const p of what) {
      const c = centre(part(p));
      const dist = (g: number) => Math.hypot(...[0, 2].map((k) => centre(part(g))[k] - c[k]));
      const goal = goals.reduce<number | null>((best, g) => (best == null || dist(g) < dist(best) ? g : best), null);
      if (goal == null) continue;
      const f = turned(part(p).rotation, axis);
      const to = [0, 2].map((k) => (centre(part(goal))[k] - c[k]) * (away ? -1 : 1));
      const len = Math.hypot(f[0], f[2]) * Math.hypot(to[0], to[1]);
      if (len < 1e-9) continue;
      const deg = (Math.acos(Math.max(-1, Math.min(1, (f[0] * to[0] + f[2] * to[1]) / len))) * 180) / Math.PI;
      if (deg > within) {
        found({ about: [p, goal], says: `${part(p).name} is turned ${Math.round(deg)} degrees from facing ${away ? "away from " : ""}${part(goal).name}`, measure: { name: "facing", value: Math.round(deg), unit: "deg", limit: within } });
      }
    }
  },
  (values, memo) => {
    if (!memo.what) found({ says: `no part on any frame is ${values.what}: nothing to face` });
    else if (!memo.goals) found({ says: `no part on any frame is ${values.toward ?? values.away}, for ${values.what} to face ${values.toward == null ? "away from" : ""}`.trim() });
  },
);
