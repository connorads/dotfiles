import { expect, test } from "bun:test"
import { fixMishearings } from "./fixes.ts"

test("a word glued to .files becomes the word and dotfiles", () => {
  expect(fixMishearings("We'll need to push my.files because")).toBe("We'll need to push my dotfiles because")
  expect(fixMishearings("Is it in.files? Like.files is one word")).toBe("Is it in dotfiles? Like dotfiles is one word")
})

test("other dotted words stay", () => {
  expect(fixMishearings("open hex.config.ts and opencode.ai")).toBe("open hex.config.ts and opencode.ai")
})
