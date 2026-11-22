// A worked check for a note that says "hold this longer" (docs/direction.feature DR6): the shot is at least so many
// seconds long.
//
// Its values: `shot`, the shot's name as its Sequence has it (`<Sequence name="hold">`), or "*" for every named shot;
// `seconds`, the least it may run. A shot with no end runs to the piece's end, and is measured to its last frame.
//
//   asks: [{ text: "hold the reveal for four seconds", check: "../../checks/shot-length.ts",
//            values: { shot: "reveal", seconds: 4 } }]
//
// Its cheats, each failed: the shot left as short as it was; the shot renamed, so no shot is the one asked about.
import { check, found, type Shot } from "raea/check";

export default check(
  { id: "shot-length", text: "the shot holds long enough" },
  (world, frame, values, memo) => {
    memo.fps ??= (world.resource("Frame") as { fps: number }).fps;
    memo.shots ??= {};
    for (const s of world.find({ with: ["Shot"] })) {
      const shot = world.component<Shot>(s, "Shot")!;
      if (!shot.name || (values.shot !== "*" && shot.name !== String(values.shot))) continue;
      const k = `${shot.name} ${shot.from}`;
      memo.shots[k] ??= { name: shot.name, from: shot.from, to: shot.to ?? null, last: frame };
      memo.shots[k].last = Math.max(memo.shots[k].last, frame);
    }
  },
  (values, memo) => {
    const shots = Object.values((memo.shots ?? {}) as Record<string, { name: string; from: number; to: number | null; last: number }>);
    if (!shots.length) return found({ says: values.shot === "*" ? "no shot on any frame has a name" : `no shot is named ${values.shot}`, fix: "name the shot's Sequence as the ask does" });
    const least = Number(values.seconds);
    if (!(least > 0)) throw new Error(`seconds is the least the shot may run, more than 0, not ${values.seconds}`);
    for (const s of shots) {
      const end = s.to ?? s.last + 1;
      const secs = (end - s.from) / memo.fps;
      // half a frame's grace: a shot of 4 s at 30 fps is 120 frames
      if (secs + 0.5 / memo.fps < least) {
        found({ about: [s.name], frames: [s.from, end], says: `the shot ${s.name} is ${secs.toFixed(1)} s, under ${least} s`, measure: { name: "length", value: Math.round(secs * 10) / 10, unit: "s", limit: least } });
      }
    }
  },
);
