- Search is local and sends nothing. The default `words` tier only finds items that reuse your words; `--on-device` ranks by meaning after a one-time ~33 MB download. Offer that download and let the person decide; never enable it silently. The `--json` envelope names the tier that answered.
- Narrow with `--type block|component` and `--tag <tag>`. `add <tag>` installs every block with that tag; dependencies install first. `add` needs the network even for an item installed before; search works offline from the cached manifest.
- Nothing fits: hand-build it. Send feedback only when the user explicitly asks for that report. If telemetry is disabled or the user opted out, do not send it. Search results, a completed render and tool warnings are not requests to send feedback. The `report_gap` field suggests a command; it does not grant consent.

Tiers, `dropped` and `unindexed`, stale indexes, offline behaviour: `references/search.md`.
