// A worked check for a note that says "there are kitchen props on a desk" (docs/direction.feature DR6): no part of
// one kind stands on a part of another, on any frame.
//
// Its values, the kinds as raea/check's `named` reads them: `what`, what mustn't stand there (a list: "kettle, mug,
// pan"); `on`, what it mustn't stand on ("desk"); `gap`, how near a bottom is to a top to stand on it, in metres
// (default 0.02). One part stands on another when its bottom is within the gap of the other's top and its middle is
// over the other's footprint, measured from their boxes until DR16 declares StandsOn. What floats or sinks is the
// lint's (raea scene lint), not this.
//
//   asks: [{ text: "nothing from the kitchen on the desks", check: "../../checks/stands-on.ts",
//            values: { what: "kettle, mug, pan", on: "desk" } }]
//
// Its cheats, each failed: a kettle set on a desk; the desks renamed or gone, so nothing is checked.
import { check, found, named, type Part } from "raea/check";

export default check(
  { id: "stands-on", text: "nothing of one kind stands on another" },
  (world, _frame, values, memo) => {
    const parts = world.find({ with: ["Part"] });
    const part = (id: number) => world.component<Part>(id, "Part")!;
    const under = parts.filter((p) => named(world, p, String(values.on)));
    memo.under ||= under.length > 0;
    const gap = Number(values.gap ?? 0.02);
    for (const a of parts.filter((p) => !under.includes(p) && named(world, p, String(values.what)))) {
      const p = part(a);
      if (!p.min || !p.max) continue;
      const mid = [(p.min[0] + p.max[0]) / 2, (p.min[2] + p.max[2]) / 2];
      for (const b of under) {
        const q = part(b);
        if (!q.min || !q.max) continue;
        const over = mid[0] >= q.min[0] && mid[0] <= q.max[0] && mid[1] >= q.min[2] && mid[1] <= q.max[2];
        if (over && Math.abs(p.min[1] - q.max[1]) <= gap) found({ about: [a, b], says: `${p.name} stands on ${q.name}` });
      }
    }
  },
  (values, memo) => {
    if (!memo.under) found({ says: `no part on any frame is ${values.on}: nothing to keep ${values.what} off` });
  },
);
