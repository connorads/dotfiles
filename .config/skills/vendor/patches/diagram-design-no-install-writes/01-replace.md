Resolve the project `.diagram-design` marker per [`references/profiles.md`](references/profiles.md); a successfully resolved marker selects its profile and bypasses this gate. That reference owns failures, the protected default, and save behavior.

{{marker}}

**This install is read-only.** Every branding route writes a named profile under `~/.diagram-design/profiles/` and selects it through the project's `.diagram-design` marker. Never write tokens or profile headers into the installed `references/style-guide.md`, including save, load, switch, update and reset.
