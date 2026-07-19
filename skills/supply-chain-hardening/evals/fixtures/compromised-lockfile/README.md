# Grading fixture — never install

This lockfile deliberately pins `@ctrl/tinycolor@4.1.1`, a version with a real
OSV malware advisory (MAL-2025-47141, Shai-Hulud worm). It exists as inert text
for grading incident-response behaviour only. Never run `npm install` /
`pnpm install` in a copy of this directory.
