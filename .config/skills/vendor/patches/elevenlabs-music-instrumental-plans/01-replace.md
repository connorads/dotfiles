each 3,000–120,000 ms, total length 3 s to 10 minutes; each `text` is sung, not read as direction.

{{marker}}
Stage directions in `text`, such as "[Intro] playful pizzicato strings", came back as vocals
reading the direction aloud (confirmed with speech-to-text, 2026-09-25). For an instrumental
plan, leave every `text` empty and put the direction in `positive_styles`, with "vocals" and
"singing" in `negative_styles`. With empty text the model follows per-chunk moods only loosely;
when a score must change mood on exact beats, generate one prompt-mode track per mood with
`force_instrumental=True` and cut between them.
