// The match cuts, checked in the render (`raea guide match-cuts`): at every cut of a chain (chain.ts), the hooked part
// sits at its thirds place on the frame before the cut and on the frame after it. A project makes the check from its
// chain in a file of its own, and a rule (a controller's, or a note's ask) names that file:
//
//   // checks/film-cuts.ts
//   import { landsOnThirds } from "./match-cuts/thirds";
//   import film from "../film.chain";
//   export default landsOnThirds(film);
//
//   { label: "the cuts land on the thirds", type: "rule", check: "../checks/film-cuts.ts", values: { tolerance: 0.06 } }
//
// `raea check film.tsx --only film-cuts` runs it alone (a rule goes by its check file's name; a note's ask by its own
// id, as `--only n1.1`), and its findings say `lands-on-thirds`. Its values: `tolerance`, how far a hook may sit from its
// place, as a share of the frame's width (across) and height (down), 0.06 when unset (the thirds' points are a sixth of
// the frame apart); `full`, the share of the frame a FULL hook covers, 0.9 when unset; `plan`, false to leave out the
// plan checks, which otherwise run once after the frames, so one rule holds both.
//
// It reads raea world's facts, no render: a part (matched by raea/check's named(): its name, its model file, its layer
// key, or component:Name) by its world box, projected through the frame's camera; a text by its laid-out box. Where
// several parts have the name, the one nearest its place is measured. Each cut of the chain must be a cut of the
// composition: a Sequence that starts on the chain's frame (and has the shot's name, when the chain gives one). A J
// bridge's sound is placed `seconds` before the cut and is playing on the frame before it; an L bridge's is playing on
// the cut's frame and on the bridge's last.
//
// Its cheats, each failed (bench/direction/match-cuts/match-cuts.sh): a hook off its place; one at its place mid-shot
// that has left by the cut; the hooked part renamed or gone; a cut off the chain's frame; a FULL that doesn't fill the
// frame; a part behind the camera; a hook that names no part; a J bridge's sound starting at the cut; an L bridge's
// sound stopping at it.
//
// What it can't see: a part hidden behind another (it measures where things are, not what is drawn over them), a
// camera rolled about its view (it takes Y as up), the eye's way inside a shot (the plan's carry says it), and a 2D
// graphic that isn't text (raea world has no box for one).
import { check, found, named, type Camera, type Check, type Cue, type Part, type Shot, type Text, type World } from "raea/check";
import { LINES, NAMES, centreOf, cuts as cutsOf, planned, toFrame, type At, type Chain, type Cut, type Hook, type View } from "./chain";

type Box = [number, number, number, number];
/** A hook measured on a frame: where its centre falls, the box it covers on the frame (clipped to it), and what. */
type Seen = { id: number; name: string; u: number; v: number; cover: number };
/** One thing to measure on a frame: a cut's out hook on the frame before it, its in hook on its own frame. */
type Look = { cut: Cut | null; side: "out" | "in"; hook: Hook; loop?: boolean };

/** How far (u, v) is from `at`, as a share of the frame: across and down for a point, one of them for a line. */
function off(at: At, u: number, v: number): number {
  if (at === "FULL") return 0;
  const [tu, tv] = centreOf(at);
  if (at in LINES) return LINES[at as keyof typeof LINES].axis === "H" ? Math.abs(v - tv) : Math.abs(u - tu);
  return Math.max(Math.abs(u - tu), Math.abs(v - tv));
}

const area = (b: Box) => Math.max(0, Math.min(1, b[2]) - Math.max(0, b[0])) * Math.max(0, Math.min(1, b[3]) - Math.max(0, b[1]));

/** A world box on the frame: its corners in front of the eye and where its edges cross the near plane, projected. Null
 * when it is all behind the eye. */
function boxOnFrame(min: number[], max: number[], cam: View, aspect: number, near: number): Box | null {
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  const z = corners.map((p) => toFrame(p, cam, aspect).z);
  const pts: number[][] = corners.filter((_, i) => z[i] > near);
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
    const j = i | bit;
    if (j === i || (z[i] > near) === (z[j] > near)) continue;
    const t = (near - z[i]) / (z[j] - z[i]);
    pts.push(corners[i].map((x, k) => x + (corners[j][k] - x) * (t + 1e-6)));
  }
  if (!pts.length) return null;
  const on = pts.map((p) => toFrame(p, cam, aspect));
  return [Math.min(...on.map((p) => p.u)), Math.min(...on.map((p) => p.v)), Math.max(...on.map((p) => p.u)), Math.max(...on.map((p) => p.v))];
}

/** Every part or text named `part` on the frame, measured; and the parts of that name behind the eye. */
function measure(world: World, part: string, aspect: number): { seen: Seen[]; behind: string[] } {
  const seen: Seen[] = [];
  const behind: string[] = [];
  const camId = world.find({ with: ["Camera"] })[0];
  const cam = camId === undefined ? undefined : world.component<Camera>(camId, "Camera");
  for (const id of world.find({ with: ["Text"] })) {
    const t = world.component<Text>(id, "Text")!;
    if (!t.box || !(named(world, id, part) || t.words.toLowerCase().startsWith(part.toLowerCase()))) continue;
    const b = t.box as Box;
    seen.push({ id, name: t.words, u: (b[0] + b[2]) / 2, v: (b[1] + b[3]) / 2, cover: area(b) });
  }
  for (const id of world.find({ with: ["Part"] })) {
    const p = world.component<Part>(id, "Part")!;
    if (!named(world, id, part) || !p.min || !p.max) continue;
    if (!cam) { behind.push(`${p.name} (no camera on the frame)`); continue; }
    const centre = [0, 1, 2].map((k) => (p.min![k] + p.max![k]) / 2);
    const c = toFrame(centre, cam, aspect);
    const box = boxOnFrame(p.min, p.max, cam, aspect, cam.near);
    if (c.z <= cam.near || !box) { behind.push(p.name); continue; }
    seen.push({ id, name: p.name, u: c.u, v: c.v, cover: area(box) });
  }
  return { seen, behind };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const stem = (s: string) => (s.split("/").pop() ?? s).replace(/\.[^.]+$/, "").toLowerCase();

export type Options = { id?: string; tolerance?: number; full?: number; plan?: boolean };

/** The check that holds a composition to its chain at every cut (its values override `opts`). */
export function landsOnThirds(c: Chain, opts: Options = {}): Check {
  const fps = c.fps;
  const looks = new Map<number, Look[]>();
  const at = (f: number, l: Look) => { if (f >= 0) looks.set(f, [...(looks.get(f) ?? []), l]); };
  const all = cutsOf(c);
  for (const k of all) {
    if (k.join === "hard") continue;
    at(k.frame - 1, { cut: k, side: "out", hook: k.leaves.out });
    at(k.frame, { cut: k, side: "in", hook: k.lands.in });
  }
  const last = Math.round(c.length * fps) - 1;
  if (c.loop && c.shots.length > 1) {
    at(0, { cut: null, side: "in", hook: c.shots[0].in, loop: true });
    at(last, { cut: null, side: "out", hook: c.shots[c.shots.length - 1].out, loop: true });
  }
  // the frames a bridge is heard on: J the frame before its cut; L its cut's frame and its last
  const lEnd = (k: Cut) => k.frame + Math.max(1, Math.round(k.lands.bridge!.seconds * fps)) - 1;
  const frames = new Set<number>(looks.keys());
  for (const k of all) {
    frames.add(k.frame);
    if (k.lands.bridge?.kind === "J") frames.add(k.frame - 1);
    if (k.lands.bridge?.kind === "L") frames.add(lEnd(k));
  }

  return check(
    { id: opts.id ?? "lands-on-thirds", text: "at every cut the hooked part sits at its thirds place, on the frame before and the frame after", frames: [...frames].filter((f) => f >= 0).sort((a, b) => a - b) },
    (world, frame, values, memo) => {
      const fr = world.resource("Frame") as { width: number; height: number };
      const aspect = fr.width / fr.height;
      const tol = Number(values.tolerance ?? opts.tolerance ?? 0.06);
      const full = Number(values.full ?? opts.full ?? 0.9);
      memo.cuts ??= {};
      memo.unnamed ??= {};
      const shots = world.find({ with: ["Shot"] }).map((id) => world.component<Shot>(id, "Shot")!);
      for (const k of all) {
        if (k.frame !== frame) continue;
        const name = k.lands.name;
        if (shots.some((s) => s.from === frame && (!name || s.name === name))) memo.cuts[k.index] = true;
      }
      for (const l of looks.get(frame) ?? []) {
        const where = l.loop ? `the loop's ${l.side === "in" ? "first" : "last"} frame` : `the frame ${l.side === "out" ? "before" : "after"} cut ${l.cut!.index} (${l.cut!.leaves.scene} to ${l.cut!.lands.scene}, ${l.cut!.time.toFixed(2)} s)`;
        if (!l.hook.part?.trim()) { memo.unnamed[`${l.cut?.index ?? "loop"} ${l.side}`] = `${l.hook.what} (${where})`; continue; }
        const { seen, behind } = measure(world, l.hook.part, aspect);
        if (!seen.length) {
          found({ about: [l.hook.part], says: behind.length ? `${l.hook.what} (${l.hook.part}) is behind the camera on ${where}` : `no part or text named ${l.hook.part} (${l.hook.what}) on ${where}`, fix: behind.length ? "put it in front of the camera, at its place" : "name the part as the chain's hook does (raea world lists the frame's parts)" });
          continue;
        }
        if (l.hook.at === "FULL") {
          const best = seen.reduce((a, s) => (s.cover > a.cover ? s : a));
          if (best.cover < full) found({ about: [best.id], says: `${l.hook.what} (${best.name}) covers ${pct(best.cover)} of ${where}, not the whole frame`, measure: { name: "cover", value: Math.round(best.cover * 100) / 100, unit: "share", limit: full } });
          continue;
        }
        const best = seen.reduce((a, s) => (off(l.hook.at, s.u, s.v) < off(l.hook.at, a.u, a.v) ? s : a));
        const d = off(l.hook.at, best.u, best.v);
        if (d > tol) found({ about: [best.id], says: `${l.hook.what} (${best.name}) sits at ${pct(best.u)} across, ${pct(best.v)} down on ${where}, ${pct(d)} of the frame from the ${NAMES[l.hook.at]}`, measure: { name: "off", value: Math.round(d * 1000) / 1000, unit: "share", limit: tol } });
      }
      // the bridges: a cue of the bridge's sound, by its file's name or its layer
      const cues = world.find({ with: ["Cue"] }).map((id) => ({ id, cue: world.component<Cue>(id, "Cue")! }));
      const heard = (sound: string) => cues.filter(({ id, cue }) => named(world, id, sound) || stem(cue.source).startsWith(sound.toLowerCase()));
      for (const k of all) {
        const b = k.lands.bridge;
        if (!b) continue;
        const into = `cut ${k.index} (${k.leaves.scene} to ${k.lands.scene}, ${k.time.toFixed(2)} s)`;
        if (b.kind === "J" && frame === k.frame - 1) {
          const want = k.time - b.seconds;
          const got = heard(b.sound);
          if (!got.some(({ cue }) => Math.abs(cue.at - want) <= 1.5 / fps)) found({ about: [b.sound], says: got.length ? `the J bridge's ${b.sound} starts at ${got[0].cue.at.toFixed(2)} s, not ${b.seconds} s before ${into}` : `the J bridge's ${b.sound} isn't playing on the frame before ${into}`, fix: `start it at ${want.toFixed(2)} s, under the shot before` });
        }
        if (b.kind === "L" && (frame === k.frame || frame === lEnd(k))) {
          const got = heard(b.sound).filter(({ cue }) => cue.at < k.time - 0.5 / fps);
          if (!got.length) found({ about: [b.sound], says: `the L bridge's ${b.sound} ${frame === k.frame ? "stops at" : "doesn't run"} ${b.seconds} s past ${into}`, fix: `let the sound the shot before started run ${b.seconds} s into ${k.lands.scene}` });
        }
      }
    },
    (values, memo) => {
      for (const k of all) {
        if (!memo.cuts?.[k.index]) found({ about: [k.lands.name ?? k.lands.scene], frames: [k.frame, k.frame + 1], says: `the chain cuts into ${k.lands.scene} on frame ${k.frame} (${k.time.toFixed(2)} s), and the composition doesn't: no Sequence${k.lands.name ? ` named ${k.lands.name}` : ""} starts there`, fix: "build each shot as its Sequence from the chain (chain.ts sequences())" });
      }
      for (const [k, what] of Object.entries((memo.unnamed ?? {}) as Record<string, string>)) found({ says: `the hook ${what} names no part, so nothing measures it`, fix: "give the hook the part that draws it (part: its name in the scene)" });
      if ((values.plan ?? opts.plan ?? true) === false) return;
      for (const r of planned(c)) for (const f of r.fails) found({ says: `the plan, ${r.id}: ${f}`, fix: r.text });
    },
  );
}
