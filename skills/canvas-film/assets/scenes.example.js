/* oxlint-disable no-unused-vars -- CAPTIONS, POSTER and SCENES are read by engine.html once build inlines this file */
// Scenes: { id, a, b, tr, draw(t) }. a/b are seconds; consecutive scenes
// overlap by ~0.1-0.3s and the later scene's `tr` ("slide" | "drop" | "cut")
// runs across the overlap. Anchor every beat to a word, not a number:
// word("n01", "curry") survives re-voicing a line; 15.17 does not.
const CAPTIONS = new Set(["n01"]); // narrator lines that get a caption
const POSTER = 1.5;                // frame shown before play

const SCENES = [
  { id: "title", a: 0, b: 2.4, tr: null, draw(t) {
    paperBG(t); doodles(t, 4);
    rays(W / 2, H * .47, t, "rgba(233,182,52,.18)", 18, 1, .08);
    ransom("A SHORT FILM", W / 2, 420, 150, t, .2, { seed: 3 });
    stamp("A NATURE DOCUMENTARY", W / 2, 680, 64, t, 1.1, { rot: -.05, color: "#2f6f73", font: F.type });
  } },
  { id: "intro", a: 2.25, b: END + 1, tr: "slide", draw(t) {
    paperBG(t);
    // head("alex", 960, 600, 500, { t, seed: 1 });       // needs assets/img/alex_rest + alex_talk
    // bubble(1400, 250, 560, 220, 1100, 420, ["Hello!"], t, clip("a01").start, { size: 60, font: F.hand });
    label("scene two", W / 2, H / 2, 90, { font: F.marker, t, alpha: inv(2.4, 2.8, t) });
  } },
];
