import { readFileSync } from "node:fs";
import { countWords } from "./count.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: tally <file>");
  process.exit(2);
}
console.log(countWords(readFileSync(file, "utf8")));
