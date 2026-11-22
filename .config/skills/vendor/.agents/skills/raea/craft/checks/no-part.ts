// A worked check for a note that says "no orbs anywhere" (docs/direction.feature DR6): no part of the named kind is
// in the piece, on any frame, seen or not.
//
// Its values: `what`, the kind as raea/check's `named` reads it. A component the note means is best named by what
// drew it (`component:Orb`), which renaming its parts doesn't change.
//
//   asks: [{ text: "no orbs anywhere", check: "../../checks/no-part.ts", values: { what: "component:Orb" } }]
//
// Its cheats, each failed: one orb left in a corner of one shot; the orb's mesh renamed while the Orb component still
// draws it; the orb scaled to nothing, which is still an orb.
import { check, found, named, type Part } from "raea/check";

export default check({ id: "no-part", text: "nothing of the kind is in the piece" }, (world, _frame, values) => {
  // what the note calls it, as a person says it: "component:Orb" is an Orb
  const label = String(values.what).replace(/\b(component|file):/g, "");
  for (const p of world.find({ with: ["Part"] }).filter((p) => named(world, p, String(values.what)))) {
    found({ about: [p], says: `${world.component<Part>(p, "Part")!.name} is there, and the note asks for no ${label}` });
  }
});
