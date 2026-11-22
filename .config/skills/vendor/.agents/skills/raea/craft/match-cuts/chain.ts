// A piece's cuts planned as a chain of hooks on the frame's thirds (`raea guide match-cuts`). Each shot takes the eye
// in where the last one left it, on a hook (what the eye is on, and where on the thirds), and its action carries the
// eye to the hook the next cut leaves from. A storyboard (NAME.script.ts) states its chain beside it, in NAME.chain.ts:
//
//   import { chain } from "./checks/match-cuts/chain";
//   export default chain({ fps: 30, length: 12, shots: [
//     { scene: "kitchen", seconds: 4, in: { what: "the kettle", at: "CC", glyph: "circle" }, out: { what: "the steam", at: "TR", glyph: "streaks" }, carry: "the steam rises to the upper right" },
//     { scene: "street", seconds: 8, cut: "graphic", in: { what: "rain on the window", at: "TR", glyph: "streaks" }, ... },
//   ] });
//
// and the plan checks below hold it, by name: `bun checks/match-cuts/plan.ts NAME.chain.ts --only lands,glyph`. The render
// check (thirds.ts) holds the composition to the same chain, at every cut.
//
// It imports nothing, so bun runs it and so does raea check's bundle. A project copies this folder from the skill
// (craft/match-cuts) into its checks/match-cuts/, as it copies a note's worked checks.

/** The nine points: the thirds' four crossings, the middles of the thirds lines, and the centre. */
export type Point = "TL" | "TC" | "TR" | "ML" | "CC" | "MR" | "BL" | "BC" | "BR";
/** The four thirds lines: H1 and H2 across (upper, lower), V1 and V2 down (left, right). */
export type Line = "H1" | "H2" | "V1" | "V2";
/** Where a hook is: a point, a line, or FULL, a thing that fills the frame (a screen pushed into, a sheet over the lens). */
export type At = Point | Line | "FULL";
/** What a hook is, as the eye reads its shape. */
export type Glyph = "circle" | "rect" | "hline" | "vline" | "vanish" | "diag" | "blob" | "streaks" | "dots";
/** The way a hook moves on screen at the cut: across, up or down, toward the lens or away, or turning. */
export type Move = "left" | "right" | "up" | "down" | "in" | "out" | "cw" | "ccw";
/** How a shot is cut into from the one before it:
 *  - graphic: the same place, a thing of the same shape (a sun to a dryer's window);
 *  - motion: the same place, moving the same way (a pan's sweep to a car passing in the pan's direction);
 *  - eye: the same place, any thing, on a beat (the eye is already there when the cut comes);
 *  - full: a thing fills the lens and the next shot starts filled (a wipe by a flank, a sheet, a push into a screen);
 *  - sound: the picture moves on and a sound carries the cut (a J or L bridge);
 *  - hard: the place breaks on purpose, on a hit (a shock, a jump in time, a new act). */
export type Join = "graphic" | "motion" | "eye" | "full" | "sound" | "hard";

export type Hook = {
  /** what the eye is on, in words ("the sun's disc, sinking") */
  what: string;
  at: At;
  glyph: Glyph;
  /** the part or text that draws it, as raea/check's named() reads a name: the render check measures it */
  part?: string;
  /** the way it moves on screen at the cut: a motion join keeps it */
  move?: Move;
  /** its colour or its light, when the match is on them (words; the board shows them) */
  colour?: string;
  light?: string;
};

/** A sound carried across a cut: J, the next shot's sound starts `seconds` before the cut, under the shot before; L,
 * the shot before's sound runs `seconds` into the next. `sound` names its file as the render check finds it (the
 * file's name, or its start). */
export type Bridge = { kind: "J" | "L"; sound: string; seconds: number };

export type Shot = {
  /** its Sequence's name in the composition */
  name?: string;
  /** the place it is in */
  scene: string;
  seconds: number;
  /** where the eye comes in, and where the next cut leaves from */
  in: Hook;
  out: Hook;
  /** how it is cut into from the shot before (graphic when unset); the first shot's is the loop's, when it loops */
  cut?: Join;
  /** what the cut lands on: a beat, a hit, a word (a hard cut must say) */
  on?: string;
  /** a sound carried across the cut into this shot */
  bridge?: Bridge;
  /** what carries the eye from in to out: a drag, the camera's move, a light's sweep (needed when they differ) */
  carry?: string;
  /** one of a montage's shots: a run of them hands one hook on, cut to cut */
  montage?: boolean;
  /** anything else the board shows */
  note?: string;
};

export type ChainInput = {
  title?: string;
  fps: number;
  /** the piece's length in seconds: the shots must run it to a frame */
  length: number;
  /** the frame's shape, width by height (16:9 when unset), for the board and the render check's tolerance */
  aspect?: [number, number];
  /** the music's beats in seconds, when cut to music: every cut lands on one */
  beats?: number[];
  /** the last shot's out cuts back to the first shot's in, as the piece plays again */
  loop?: boolean;
  shots: Shot[];
};

/** A shot placed in the piece: its start in seconds, its first frame and how many frames it runs. */
export type Placed = Shot & { from: number; frame: number; frames: number };
export type Chain = Omit<ChainInput, "shots"> & { shots: Placed[] };

/** A cut: the shot it leaves and the one it lands in, how it joins them, and when. */
export type Cut = { leaves: Placed; lands: Placed; join: Join; time: number; frame: number; index: number };

/** A place a chain can cut to: its hooks, for the board's library. */
export type Place = { id: string; title: string; about?: string; hooks: Hook[]; props?: string[]; kind?: string };

/** A point's place on the frame, 0..1 across and down. */
export const POINTS: Record<Point, [number, number]> = {
  TL: [1 / 3, 1 / 3], TC: [1 / 2, 1 / 3], TR: [2 / 3, 1 / 3],
  ML: [1 / 3, 1 / 2], CC: [1 / 2, 1 / 2], MR: [2 / 3, 1 / 2],
  BL: [1 / 3, 2 / 3], BC: [1 / 2, 2 / 3], BR: [2 / 3, 2 / 3],
};
/** A line's place: H across at that height, V down at that width. */
export const LINES: Record<Line, { axis: "H" | "V"; at: number }> = {
  H1: { axis: "H", at: 1 / 3 }, H2: { axis: "H", at: 2 / 3 }, V1: { axis: "V", at: 1 / 3 }, V2: { axis: "V", at: 2 / 3 },
};
export const NAMES: Record<At, string> = {
  TL: "upper-left third", TC: "upper third, centre", TR: "upper-right third", ML: "left third, middle", CC: "centre",
  MR: "right third, middle", BL: "lower-left third", BC: "lower third, centre", BR: "lower-right third",
  H1: "upper thirds line", H2: "lower thirds line", V1: "left thirds line", V2: "right thirds line", FULL: "the whole frame",
};
export const GLYPHS: Glyph[] = ["circle", "rect", "hline", "vline", "vanish", "diag", "blob", "streaks", "dots"];
export const JOINS: Join[] = ["graphic", "motion", "eye", "full", "sound", "hard"];
const isPoint = (a: At): a is Point => a in POINTS;
const isLine = (a: At): a is Line => a in LINES;

/** Where a thing at `at` sits, 0..1 across and down: a line at its middle, FULL at the centre. */
export const centreOf = (at: At): [number, number] => {
  if (at === "FULL") return [0.5, 0.5];
  if (isPoint(at)) return POINTS[at];
  const l = LINES[at];
  return l.axis === "H" ? [0.5, l.at] : [l.at, 0.5];
};

/** Glyphs that read as the same thing across a cut. */
export const SAME: Glyph[][] = [["circle"], ["rect"], ["hline"], ["vline", "diag"], ["vanish"], ["blob", "streaks", "dots"]];
export const matches = (a: Glyph, b: Glyph) => SAME.some((g) => g.includes(a) && g.includes(b));

/** Whether a cut from `a` lands the eye on `b`: the same place, or a point on the line the other is. FULL lands only
 * on FULL. */
export const lands = (a: At, b: At): boolean => {
  if (a === b) return true;
  if (a === "FULL" || b === "FULL") return false;
  const on = (p: At, l: At) => isPoint(p) && isLine(l) && POINTS[p][LINES[l].axis === "H" ? 1 : 0] === LINES[l].at;
  return on(a, b) || on(b, a);
};

/** The chain with each shot placed: its start, its first frame (rounded to the piece's frames) and its frames. */
export function chain(c: ChainInput): Chain {
  let t = 0;
  const starts = c.shots.map((s) => { const at = t; t += s.seconds; return at; });
  const frameOf = (s: number) => Math.round(s * c.fps);
  const shots = c.shots.map((s, i) => {
    const frame = frameOf(starts[i]);
    const end = i + 1 < c.shots.length ? frameOf(starts[i + 1]) : frameOf(t);
    return { ...s, from: Math.round(starts[i] * 1e6) / 1e6, frame, frames: end - frame };
  });
  return { ...c, shots };
}

/** The chain's cuts in order: each between a shot and the next. The loop's way back to the first shot isn't one
 * (it is no cut in the composition); `loop` checks it. */
export function cuts(c: Chain): Cut[] {
  return c.shots.slice(1).map((s, i) => ({ leaves: c.shots[i], lands: s, join: s.cut ?? "graphic", time: s.from, frame: s.frame, index: i + 1 }));
}

/** Each shot as its Sequence: its name, first frame and frames (`<Sequence name from durationInFrames>`). */
export const sequences = (c: Chain) => c.shots.map((s, i) => ({ name: s.name ?? `${i + 1}-${s.scene}`, from: s.frame, durationInFrames: s.frames }));

const said = (c: Cut) => `${c.index}: ${c.leaves.scene} ${c.leaves.out.at} ${c.leaves.out.glyph} -> ${c.lands.scene} ${c.lands.in.at} ${c.lands.in.glyph}`;
const atTime = (t: number) => `${t.toFixed(2)} s`;

/** A plan check: what it holds the chain to, and each place the chain breaks it (none: it holds). */
export type PlanCheck = { id: string; text: string; run: (c: Chain) => string[] };

export const PLAN: PlanCheck[] = [
  {
    id: "hooks",
    text: "every hook says what the eye is on, its place on the thirds and its glyph",
    run: (c) => c.shots.flatMap((s, i) => (["in", "out"] as const).flatMap((k) => {
      const h = s[k];
      const bad = [!h?.what?.trim() && "no what", !(h?.at in NAMES) && `no place on the thirds (${h?.at})`, !GLYPHS.includes(h?.glyph) && `no glyph (${h?.glyph})`, s.cut && !JOINS.includes(s.cut) && `a cut that is no join (${s.cut})`].filter(Boolean);
      return bad.length ? [`shot ${i + 1} (${s.scene}) ${k}: ${bad.join(", ")}`] : [];
    })),
  },
  {
    id: "length",
    text: "the chain runs the piece's length to a frame, and every shot is at least a frame",
    run: (c) => {
      if (!(c.fps > 0) || !(c.length > 0)) return [`fps ${c.fps} and length ${c.length} must both be more than 0`];
      const total = c.shots.reduce((a, s) => a + s.seconds, 0);
      const out = Math.abs(total - c.length) <= 1 / c.fps + 1e-9 ? [] : [`the shots run ${atTime(total)}, the piece ${atTime(c.length)}`];
      return [...out, ...c.shots.filter((s) => s.frames < 1).map((s) => `shot ${c.shots.indexOf(s) + 1} (${s.scene}) is under a frame (${s.seconds} s)`)];
    },
  },
  {
    id: "lands",
    text: "every match cut lands the eye on the thirds place the last shot left it",
    run: (c) => cuts(c).filter((k) => k.join !== "hard" && k.join !== "sound").filter((k) => {
      if (k.join === "full") return k.leaves.out.at !== "FULL" || k.lands.in.at !== "FULL";
      return !lands(k.leaves.out.at, k.lands.in.at);
    }).map((k) => `${said(k)}${k.join === "full" ? " (a full cut leaves on a thing filling the frame and lands on one)" : ""}`),
  },
  {
    id: "glyph",
    text: "a graphic cut, and every cut in a montage, lands on the same kind of thing",
    run: (c) => cuts(c).filter((k) => k.join === "graphic" || (k.leaves.montage && k.lands.montage)).filter((k) => !matches(k.leaves.out.glyph, k.lands.in.glyph)).map(said),
  },
  {
    id: "motion",
    text: "a motion cut keeps the way the thing moves across the cut",
    run: (c) => cuts(c).filter((k) => k.join === "motion").filter((k) => !k.leaves.out.move || k.leaves.out.move !== k.lands.in.move).map((k) => `${k.index}: ${k.leaves.scene} moves ${k.leaves.out.move ?? "nowhere said"}, ${k.lands.scene} ${k.lands.in.move ?? "nowhere said"}`),
  },
  {
    id: "carry",
    text: "a shot whose eye moves from its in to its out says what carries it there",
    run: (c) => c.shots.filter((s) => !lands(s.in.at, s.out.at) && !s.carry?.trim()).map((s) => `shot ${c.shots.indexOf(s) + 1} (${s.scene}): ${s.in.at} to ${s.out.at} with nothing carrying the eye`),
  },
  {
    id: "hard",
    text: "a hard cut says what it lands on (a hit, a word, a beat)",
    run: (c) => cuts(c).filter((k) => k.join === "hard" && !k.lands.on?.trim()).map((k) => `${k.index}: the hard cut into ${k.lands.scene} at ${atTime(k.time)} lands on nothing said`),
  },
  {
    id: "beats",
    text: "cut to music, every picture cut lands on a beat; an eye-trace cut always does",
    run: (c) => {
      const near = (t: number) => (c.beats ?? []).some((b) => Math.abs(b - t) <= 1 / c.fps + 1e-6);
      return cuts(c).filter((k) => k.join === "eye" || (c.beats && k.join !== "sound")).filter((k) => !near(k.time)).map((k) => c.beats ? `${k.index}: the ${k.join} cut into ${k.lands.scene} at ${atTime(k.time)} is off the beat` : `${k.index}: an eye-trace cut at ${atTime(k.time)}, and the chain has no beats to land it on`);
    },
  },
  {
    id: "bridge",
    text: "a sound cut carries a sound across it, and every bridge fits the shot it reaches into",
    run: (c) => cuts(c).flatMap((k) => {
      const b = k.lands.bridge;
      if (!b) return k.join === "sound" ? [`${k.index}: a sound cut into ${k.lands.scene} with no bridge`] : [];
      if (b.kind !== "J" && b.kind !== "L") return [`${k.index}: a bridge is J or L, not ${b.kind}`];
      if (!b.sound?.trim() || !(b.seconds > 0)) return [`${k.index}: a bridge names its sound and runs more than 0 s`];
      const into = b.kind === "J" ? k.leaves : k.lands;
      return b.seconds <= into.seconds ? [] : [`${k.index}: the ${b.kind} bridge runs ${b.seconds} s into ${into.scene}, which is ${into.seconds} s`];
    }),
  },
  {
    id: "montage",
    text: "a montage is three or more shots handing one hook on, with no hard cut inside it",
    run: (c) => {
      const runs: Placed[][] = [];
      c.shots.forEach((s, i) => { if (s.montage) (c.shots[i - 1]?.montage ? runs[runs.length - 1] : (runs[runs.length] = [])).push(s); });
      return runs.flatMap((r) => {
        const first = r[0].in.glyph;
        const where = `the montage from ${r[0].scene} (shot ${c.shots.indexOf(r[0]) + 1})`;
        if (r.length < 3) return [`${where} is ${r.length} shot(s)`];
        const off = r.flatMap((s) => [s.in, s.out]).filter((h) => !matches(first, h.glyph));
        const hard = r.slice(1).filter((s) => s.cut === "hard" || s.cut === "sound");
        return [...(off.length ? [`${where} hands on ${first}, and ${off.map((h) => `${h.what} (${h.glyph})`).join(", ")} isn't one`] : []), ...hard.map((s) => `${where}: ${s.scene} is cut into ${s.cut}`)];
      });
    },
  },
  {
    id: "loop",
    text: "a piece that loops cuts from its last shot back to its first as a match",
    run: (c) => {
      if (!c.loop || c.shots.length < 2) return [];
      const a = c.shots[c.shots.length - 1], b = c.shots[0], join = b.cut ?? "graphic";
      const k: Cut = { leaves: a, lands: b, join, time: c.length, frame: Math.round(c.length * c.fps), index: c.shots.length };
      if (join === "hard" || join === "sound") return [`the loop back to ${b.scene} is a ${join} cut, not a match`];
      if (join === "full" ? a.out.at !== "FULL" || b.in.at !== "FULL" : !lands(a.out.at, b.in.at)) return [`the loop: ${said(k)}`];
      if (join === "graphic" && !matches(a.out.glyph, b.in.glyph)) return [`the loop: ${said(k)}`];
      if (join === "motion" && (!a.out.move || a.out.move !== b.in.move)) return [`the loop: ${a.scene} moves ${a.out.move ?? "nowhere said"}, ${b.scene} ${b.in.move ?? "nowhere said"}`];
      return [];
    },
  },
];

/** The plan checks on a chain (`only`: these by id), each with every place the chain breaks it. */
export function planned(c: Chain, only?: string[]): { id: string; text: string; fails: string[] }[] {
  const unknown = (only ?? []).filter((id) => !PLAN.some((p) => p.id === id));
  if (unknown.length) throw new Error(`no plan check named ${unknown.join(", ")}: ${PLAN.map((p) => p.id).join(", ")}`);
  return PLAN.filter((p) => !only?.length || only.includes(p.id)).map((p) => {
    let fails: string[];
    try { fails = p.run(c); } catch (e) { fails = [`couldn't read the chain: ${e instanceof Error ? e.message : String(e)}`]; }
    return { id: p.id, text: p.text, fails };
  });
}

/** A camera as raea world's Camera has it: its eye, the point it looks at, its vertical field of view in degrees (a
 * perspective camera) or the height it sees in metres (an orthographic one). Y is up, as Bevy's looking_at, or Z
 * when it looks straight up or down. */
export type View = { eye: number[]; look: number[]; fov?: number | null; ortho?: number | null };
type Basis = { f: number[]; r: number[]; u: number[] };
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return a.map((x) => x / l); };
function basis(cam: View): Basis {
  const f = unit(sub(cam.look, cam.eye));
  const y = cross(f, [0, 1, 0]);
  const r = unit(cross(f, dot(y, y) < 1e-6 ? [0, 0, 1] : [0, 1, 0]));
  return { f, r, u: cross(r, f) };
}
/** Half the height the camera sees at `z` metres ahead. */
const halfAt = (cam: View, z: number) => (cam.ortho ? cam.ortho / 2 : z * Math.tan(((cam.fov ?? 45) * Math.PI) / 360));

/** Where a point in the world falls on the frame: 0..1 across and down, and how far ahead of the eye it is (0 or less:
 * at or behind it). `aspect` is the frame's width over its height. */
export function toFrame(p: number[], cam: View, aspect: number): { u: number; v: number; z: number } {
  const { f, r, u } = basis(cam);
  const d = sub(p, cam.eye);
  const z = dot(d, f);
  const half = halfAt(cam, z);
  return { u: 0.5 + dot(d, r) / (half * aspect) / 2, v: 0.5 - dot(d, u) / half / 2, z };
}

/** The point in the world `z` metres ahead of the eye that falls on the frame at (u, v): where to put a part so it
 * sits at a hook's place (`onFrame(...centreOf("TR"), 6, cam, 16 / 9)`). */
export function onFrame(fu: number, fv: number, z: number, cam: View, aspect: number): [number, number, number] {
  const { f, r, u } = basis(cam);
  const half = halfAt(cam, z);
  const x = (2 * fu - 1) * half * aspect, y = (1 - 2 * fv) * half;
  return [0, 1, 2].map((k) => cam.eye[k] + f[k] * z + r[k] * x + u[k] * y) as [number, number, number];
}
/** `cam` moved, not turned, so the world point `p` falls on `at`'s place at the depth it has now: where one part is the
 *  hook at both ends of a shot, place it for the in hook and aim the shot's last camera with this for the out. */
export function slideTo(cam: View, at: At, p: number[], aspect: number): View {
  const [fu, fv] = centreOf(at);
  const by = sub(p, onFrame(fu, fv, toFrame(p, cam, aspect).z, cam, aspect));
  return { ...cam, eye: cam.eye.map((x, i) => x + by[i]), look: cam.look.map((x, i) => x + by[i]) };
}
