# Feedback reports

Send feedback only when the user explicitly asks for that report. If telemetry is disabled or the user opted out, do not send it. Search results, a completed render and tool warnings are not requests to send feedback.

```bash
hyperframes feedback --rating <0-10> --comment "<specific result or friction>"
```

Keep clean-run feedback concise. For any bug or friction, capture a **reproduction packet** before submitting; do not send only a symptom summary. Include the rerunnable command (relative to the project directory — feedback is submitted to a public channel, so do **not** paste absolute paths, home-directory prefixes, or user/machine identifiers), expected versus actual behavior, exact error (also strip absolute paths from stack traces — keep basename + line, drop the leading directory), whether output completed/fell back/failed, workaround, and repro-project status. For a rating ≤ 7 that describes a visual defect (black frame, flicker, corrupt output, wrong frame, blank output, other visual anomaly), also include a `COMPOSITION_STRUCTURE:` block — a privacy-preserving structural anatomy (element census + attribute presence + timeline shape) so maintainers can pattern-match against known bug families without the composition ZIP. Agents auto-fill this via the composition-census helper; the human user does not fill it by hand. If the issue did not reproduce again, say so and still include the last failing command and logs. Use `--file-issue` only with consent: it publishes a minimal reproduction to a public URL. The required packet format and privacy warning live in `references/preview-render.md`.

Missing-feature and host-app reports require an explicit user request for that report and respect for opt-outs. A feature request or host-app failure is not consent to send feedback. Omit private content, names and paths.
