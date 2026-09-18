# MacWhisper audio cleanup with transcript preservation

Treat recordings as irreplaceable until the user approves a specific cutoff.
Retaining database rows does not prove MacWhisper can open a transcript after
its audio is removed. Preserve readable exports as well as the database.

## Inspect and select

1. Locate the installed app's data directory. Inspect
   `~/Library/Application Support/MacWhisper/Database` and, for sandboxed
   installations, the corresponding path under
   `~/Library/Containers/com.goodsnooze.MacWhisper/Data/`. Inspect the live
   schema read-only; do not assume table names or date encoding across versions.
   Use the installed CLI's `--help` and official documentation to check whether
   it supports audio-only removal. Prefer a supported app operation that
   preserves transcripts when available.
2. Size existing audio files by their database creation dates, not filesystem
   mtimes or filename prefixes. Resolve the user's calendar cutoff in their
   timezone and convert it to the database's verified date convention. Use
   strict "before" semantics. Show measured buckets, then resolve any missing
   cutoff or transcript-retention choice before deleting anything.
3. Prepare a manifest of exact audio paths, owning record IDs, dates, sizes,
   modification times and file identities. Reject symlinks, paths outside the
   media root and rows whose ownership is unclear. Missing files are already
   absent, not additional savings. Do not delete unreferenced files merely
   because they are absent from the selected rows.

## Preserve before removing

1. Create a consistent SQLite backup with the SQLite backup API, including
   committed WAL data. Do not copy only the main database file while the app
   is running. Verify the backup with `PRAGMA quick_check`.
2. Resolve affected transcripts through direct session links and shared
   meeting, system-recording, voice-memo or podcast links present in the
   schema. A missing direct session ID does not mean no transcript exists.
   Export readable text plus structured records retaining transcript segments,
   speaker information, summaries and translations. Include linked dictation
   text when present. Keep the full backup for relationships or metadata not
   represented by readable exports.
3. Verify exports against the selected source records before any removal.
   Keep the backup, exports and manifest in a user-visible archive and report
   its location. Do not write private transcript content into tool output.

## Remove and verify

1. Revalidate the manifest against database dates, ownership and file identity.
   Check open-file handles; defer audio that is in use or whose use cannot be
   checked. A process's working directory alone does not establish file usage.
2. Remove only the approved manifest's audio through the permitted route.
   Follow the parent skill's deletion-rejection rules. Do not modify transcript
   records, retention settings or unrelated media. Direct audio-file removal
   leaves database media references in place; report that limitation instead
   of improvising a database migration.
3. Confirm selected files are absent and retained media remain. Compare the
   affected transcript records with the preserved snapshot, distinguishing
   concurrent app edits from cleanup effects. Record `df` immediately before
   and after removal; report observed free-space change rather than promising
   the sum of audio sizes.
4. Check affected transcripts in MacWhisper when UI access is available. If
   access is denied or the check fails, report database/export preservation
   separately from unverified or failed in-app access. Give the user the
   readable archive; do not claim that unchanged rows establish app behaviour.
