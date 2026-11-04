// Mishearings the vocabulary cannot fix. Parakeet hears "my dotfiles" as
// "my.files", and vocabulary rescoring leaves path-like tokens alone. It also
// never changes case, so "Fnox" and "FNOX" need a rule here. Only public tool
// names belong in this file; private names live in the private lexicon repo.

// Official spellings, matched ignoring case. "superbase" is a mishearing.
const NAMES: Record<string, string> = {
  supabase: "Supabase", superbase: "Supabase", pypi: "PyPI", elevenlabs: "ElevenLabs",
  hyperframes: "HyperFrames", tanstack: "TanStack", macwhisper: "MacWhisper", posthog: "PostHog",
  coderabbit: "CodeRabbit", openapi: "OpenAPI", nixos: "NixOS", sqlite: "SQLite", foldkit: "Foldkit",
}
// A name next to . / - _ @ is part of a file, package or path: leave it.
const NAME = new RegExp(`(?<![./\\-_@\\w])(${Object.keys(NAMES).join("|")})(?![./\\-_]?\\w)`, "gi")

export const fixMishearings = (text: string) =>
  text
    .replace(/\b([A-Za-z]+)\.files\b/g, "$1 dotfiles")
    .replace(/\bf[\s-]?k?nox\b/gi, "fnox")
    .replace(NAME, word => NAMES[word.toLowerCase()] ?? word)
