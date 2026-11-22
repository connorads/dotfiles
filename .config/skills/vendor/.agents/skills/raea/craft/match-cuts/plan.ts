// The plan checks on a chain file, by name, before anything renders (`raea guide match-cuts`):
//
//   bun checks/match-cuts/plan.ts NAME.chain.ts                  every plan check
//   bun checks/match-cuts/plan.ts NAME.chain.ts --only lands,glyph
//
// The file's default export is a chain (chain.ts's `chain({...})`). One line a check, PASS or FAIL with where the chain
// breaks it; exit 1 when one fails, 2 when the file can't be read.
import { resolve } from "node:path";
import { PLAN, planned, type Chain } from "./chain";

const args = process.argv.slice(2);
const at = args.indexOf("--only");
const only = at >= 0 ? (args[at + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : undefined;
const file = args.find((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1));
if (!file) {
  console.error(`usage: bun plan.ts NAME.chain.ts [--only ID,ID]\nchecks: ${PLAN.map((p) => p.id).join(", ")}`);
  process.exit(2);
}
let c: Chain;
try {
  const m = await import(resolve(file));
  c = m.default ?? m.chain;
  if (!c || !Array.isArray(c.shots)) throw new Error("its default export isn't a chain({ fps, length, shots })");
} catch (e) {
  console.error(`${file}: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
const results = planned(c, only);
const w = Math.max(...results.map((r) => r.id.length));
for (const r of results) console.log(`${r.fails.length ? "FAIL" : "PASS"}  ${r.id.padEnd(w)}  ${r.text}${r.fails.length ? `\n        ${r.fails.join("\n        ")}` : ""}`);
const bad = results.filter((r) => r.fails.length).length;
console.log(`\n${c.title ?? file}: ${c.shots.length} shots, ${c.shots.length - 1} cuts; ${results.length - bad} pass, ${bad} fail`);
process.exit(bad ? 1 : 0);
