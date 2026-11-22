// A worked check for a note that says "the seat turns with the computer" (docs/direction.feature DR6): the rider
// holds its place and its turn on its seat on every frame, and no part of it is inside a part of the seat.
//
// Its values name the parts as raea/check's `named` reads them: `rider`, and `seat` (every part of the seat; the
// first found is the one the rider's place is measured from). Until DR16 gives the seat a socket, the rider's place
// and turn on the first frame that has both are what it is held to: `offset` (mm, default 10) and `turn` (degrees,
// default 1) are how far they may drift, and `into` (m, default 0.01) how far the rider may be in a part of the seat.
//
//   asks: [{ text: "the computer rides the chair as it swivels", check: "../../checks/rides.ts",
//            values: { rider: "computer", seat: "chair" } }]
//
// Its cheats, each failed: the rider set down beside the seat and left as the seat turns; the rider turned with the
// seat but pushed into its back; the rider renamed or gone (no frame has it).
import { check, found, inside, named, turned, type Part } from "raea/check";

type V = number[];
const conj = (q: V) => [-q[0], -q[1], -q[2], q[3]];
const mul = (a: V, b: V) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const degrees = (a: V, b: V) => (2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180) / Math.PI;

/** The worst a measure got and the frames it was past its limit on, kept until the run ends. */
type Bad = { from: number; to: number; worst: number; about: string[] };
const worse = (memo: Record<string, Bad>, key: string, frame: number, value: number, about: string[]) => {
  const b = memo[key];
  if (!b) memo[key] = { from: frame, to: frame + 1, worst: value, about };
  else Object.assign(b, { to: frame + 1, worst: Math.max(b.worst, value) });
};

export default check(
  { id: "rides", text: "the rider holds its place and turn on its seat, and is in no part of it" },
  (world, frame, values, memo) => {
    const parts = world.find({ with: ["Part"] });
    const part = (id: number) => world.component<Part>(id, "Part")!;
    const riders = parts.filter((p) => named(world, p, String(values.rider)));
    const seats = parts.filter((p) => !riders.includes(p) && named(world, p, String(values.seat)));
    if (!riders.length && !seats.length) return;
    memo.seen = true;
    if (!riders.length || !seats.length) {
      return found({ about: [...riders, ...seats], says: riders.length ? `the rider is here and no part is its seat (${values.seat})` : `the seat is here and no part is its rider (${values.rider})` });
    }
    const r = part(riders[0]);
    const s = part(seats[0]);
    // the rider's place and turn in the seat's own space
    const at = turned(conj(s.rotation), [0, 1, 2].map((k) => r.at[k] - s.at[k]));
    const q = mul(conj(s.rotation), r.rotation);
    memo.bad ??= {};
    if (!memo.at) Object.assign(memo, { at, q, first: frame });
    const names = [r.name, s.name];
    const mm = Math.hypot(...at.map((v, k) => v - memo.at[k])) * 1000;
    if (mm > Number(values.offset ?? 10)) worse(memo.bad, "offset", frame, mm, names);
    const deg = degrees(memo.q, q);
    if (deg > Number(values.turn ?? 1)) worse(memo.bad, "turn", frame, deg, names);
    for (const p of seats) {
      const m = inside(r, part(p));
      if (m > Number(values.into ?? 0.01)) worse(memo.bad, `into ${part(p).name}`, frame, m, [r.name, part(p).name]);
    }
  },
  (values, memo) => {
    if (!memo.seen) return found({ says: `no frame has the rider (${values.rider}) or its seat (${values.seat})`, fix: "name them in the ask's values as the scene does (raea world lists its parts)" });
    for (const [key, b] of Object.entries((memo.bad ?? {}) as Record<string, Bad>)) {
      const frames: [number, number] = [b.from, b.to];
      if (key === "offset") found({ about: b.about, frames, says: `the rider moves up to ${Math.round(b.worst)} mm on its seat from where it sat on frame ${memo.first}`, measure: { name: "offset", value: Math.round(b.worst), unit: "mm", limit: Number(values.offset ?? 10) } });
      else if (key === "turn") found({ about: b.about, frames, says: `the rider turns up to ${b.worst.toFixed(1)} degrees on its seat from how it sat on frame ${memo.first}`, measure: { name: "turn", value: Math.round(b.worst * 10) / 10, unit: "deg", limit: Number(values.turn ?? 1) } });
      else found({ about: b.about, frames, says: `the rider is up to ${Math.round(b.worst * 100)} cm ${key}`, measure: { name: "into", value: Math.round(b.worst * 100), unit: "cm", limit: Math.round(Number(values.into ?? 0.01) * 100) } });
    }
  },
);
