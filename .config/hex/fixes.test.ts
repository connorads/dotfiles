import { expect, test } from "bun:test"
import { fixMishearings } from "./fixes.ts"

test("a word glued to .files becomes the word and dotfiles", () => {
  expect(fixMishearings("We'll need to push my.files because")).toBe("We'll need to push my dotfiles because")
  expect(fixMishearings("Is it in.files? Like.files is one word")).toBe("Is it in dotfiles? Like dotfiles is one word")
})

test("fnox comes out lowercase however it was heard", () => {
  expect(fixMishearings("F Knox Fnox FNOX f-nox")).toBe("fnox fnox fnox fnox")
})

test("other dotted words and Knox alone stay", () => {
  expect(fixMishearings("open hex.config.ts and opencode.ai at Fort Knox")).toBe("open hex.config.ts and opencode.ai at Fort Knox")
})

test("public tool names get their official spelling", () => {
  expect(fixMishearings("use superbase with tanstack, posthog and sqlite")).toBe("use Supabase with TanStack, PostHog and SQLite")
  expect(fixMishearings("Pypi, Elevenlabs, hyperframes, macwhisper, coderabbit, openapi, nixos, foldkit"))
    .toBe("PyPI, ElevenLabs, HyperFrames, MacWhisper, CodeRabbit, OpenAPI, NixOS, Foldkit")
})

test("file names, packages and paths keep their spelling", () => {
  expect(fixMishearings("edit openapi.yaml, add @tanstack/query, run sqlite3 and supabase-js"))
    .toBe("edit openapi.yaml, add @tanstack/query, run sqlite3 and supabase-js")
})
