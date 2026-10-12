# The command pedal emits F18

The left pedal emits F18 while held. The helper records through Hex on key down
and transcribes on key up. Centre Right Option and right Enter retain their actions.
`pedal-flash` writes all three mappings together and checks their readback.

## Alternatives considered

Right Control loses because it holds the Control modifier during recording.
That changes the meaning of clicks and other keys. F18 provides press and release
without a modifier, and requires no physical keyboard key.
