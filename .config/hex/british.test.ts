import { expect, test } from "bun:test"
import { toBritish } from "./british.ts"

test("US spellings become British, keeping case", () => {
  expect(toBritish("The color of my favorite center")).toBe("The colour of my favourite centre")
  expect(toBritish("Analyze and organize, then prioritize.")).toBe("Analyse and organise, then prioritise.")
  expect(toBritish("COLOR Color color")).toBe("COLOUR Colour colour")
  expect(toBritish("We canceled the optimization")).toBe("We cancelled the optimisation")
})

test("words that only look American stay", () => {
  expect(toBritish("size prize seize meter program")).toBe("size prize seize meter program")
})

test("British text passes through unchanged", () => {
  expect(toBritish("colour analyse organisation")).toBe("colour analyse organisation")
})
