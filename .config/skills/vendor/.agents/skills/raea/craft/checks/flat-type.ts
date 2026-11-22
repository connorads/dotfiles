// A worked check for a note that says "2D text with occlusion" (docs/direction.feature DR6): the words are flat 2D
// type (no depth, not a 3D part, on a layer whose medium is 2d-type) on every frame they're on, and the subject is in
// front of them where they meet.
//
// Its values: `words`, the text it is about (any case, punctuation aside; unset: each line sung or said on the
// frame); `subject`, what is to be in front of it, as raea/check's `named` reads it (unset: anything in front);
// `occlusion: false` when the note asks for flat type alone. What covers what is a render's (raea render --layers),
// so it waits for one. A page layer can cover type; a 3D or footage subject in front of 2D type is DR19's mask, and
// until then the check says so, and the ask is a clip for the person to sign.
//
//   asks: [{ text: "the lyric is flat type behind the singer", medium: "2D", check: "../../checks/flat-type.ts",
//            values: { words: "out of the grey", subject: "component:Singer" } }]
//
// Its cheats, each failed: 3D type a hair deep (0.002 m) facing the camera, so a frame of it reads as flat; flat type
// with nothing in front of it; the words changed so no text reads them.
import { check, found, named, type Covers, type Layer, type Line, type Text } from "raea/check";

const plain = (s: string) => s.replace(/[^a-z0-9 ]/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

export default check(
  { id: "flat-type", text: "the words are flat 2D type, with the subject in front of them where they meet", needs: "render" },
  (world, _frame, values, memo) => {
    const want = values.words != null ? [plain(String(values.words))] : world.find({ with: ["Line"] }).map((l) => plain(world.component<Line>(l, "Line")!.text));
    for (const t of world.find({ with: ["Text"] })) {
      const text = world.component<Text>(t, "Text")!;
      if (!want.some((w) => w && plain(text.words).includes(w))) continue;
      memo.seen = true;
      // its layer: its own, else the nearest one it is in
      let at: number | null = t;
      while (at != null && !world.component<Layer>(at, "Layer")) at = world.parent(at);
      const medium = at == null ? "3d" : world.component<Layer>(at, "Layer")!.medium;
      const part = !!world.components(t).Part;
      if (part || text.extruded > 0 || medium !== "2d-type") {
        found({ about: [t], says: `the words are ${part ? "3D" : medium} type${text.extruded > 0 ? `, ${text.extruded} m deep` : ""}: the note asks for flat 2D type`, fix: "set them as 2D type on the page, not Text3D" });
      }
      if (values.occlusion === false) continue;
      const over = world.find({ with: ["Covers"] }).filter((c) => (world.component<Covers>(c, "Covers") ?? []).some((x) => x.layer === t && x.share > 0));
      const subject = values.subject != null ? String(values.subject) : undefined;
      if (over.some((c) => subject == null || named(world, c, subject))) continue;
      const solid = subject != null && world.find({ with: ["Part"] }).some((p) => named(world, p, subject));
      found({
        about: [t],
        says: solid ? `the subject (${subject}) is a 3D part: 2D type behind it is DR19's mask, which raea doesn't have yet` : `nothing${subject ? ` that is ${subject}` : ""} is in front of the words where they meet: the note asks for the subject to mask them`,
        fix: solid ? "make the ask a clip for the person to sign (proof: { shot, sign: true }) until DR19" : undefined,
      });
    }
  },
  (values, memo) => {
    if (!memo.seen) found({ says: values.words != null ? `no text on any frame reads "${values.words}"` : "no line sung or said is on screen as text on any frame" });
  },
);
