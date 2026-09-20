# vox captures both tracks in one voxtap aggregate device

`vox` records the microphone and the system's own output with **one process**,
`voxtap record`, which puts the microphone and a Core Audio process tap in a single
aggregate device with the microphone as its clock master and writes `mic.wav` and
`sys.wav` from one IO proc. There is no ffmpeg in the capture path, no device
listing, no tap pre-check, and no second clock.

## Context

The previous shape ([ADR 0003](./0003-vox-system-audio-capture.md)) captured each
side with its own ffmpeg: the microphone through avfoundation, the tap through
`voxtap` on a pipe. It worked, and it cost 1.5-4 s from key press to capture with
nothing on screen meanwhile - measured on this machine:

| Step | Cost |
| --- | --- |
| `ffmpeg -f avfoundation -list_devices` to turn a mic name into an index | 0.6-2.9 s (video devices and screens are enumerated too) |
| `voxtap --check` (builds and destroys a real tap and aggregate) | ~0.2 s |
| the mic ffmpeg opening, `mic.wav` appearing | 0.3-0.45 s, once 12.5 s against a 10 s wait |
| the tap ffmpeg, `sys.wav` appearing | 0.05-0.17 s |

The two processes also start ~0.3 s apart (the tap may only be created once the
mic is open, or avfoundation blocks forever), so the tracks differ in length and
`voxtap` pads silence to a clock of its own to keep them aligned. ADR 0003 named the
fix in its last paragraph: a tap and an input device in one aggregate device.

## Alternatives considered

**Keep ffmpeg, pass the microphone's name to avfoundation instead of an index.**
Removes nothing: avfoundation matches a name by prefix while vox's default
(`Microphone`) is a substring, so the listing is still needed to resolve it; the
~0.3 s open, the tap-after-mic ordering and the two clocks all stay.

**Keep ffmpeg, resolve the index through Core Audio.** Core Audio's device order is
not avfoundation's, so the index can name the wrong microphone - the failure the
name lookup exists to prevent.

**Prompt first and change nothing else.** Hides the latency behind the title prompt
(done regardless, in `vox-toggle.sh`), but the cost and the 10 s wait's fragility
stay, and so does the skew.

**One aggregate device carrying the microphone and the tap.** Chosen. ~0.5-0.9 s
from spawn to `mic.wav`, one process, no listing, no check, and alignment by
construction. The cost is microphone capture written in Swift rather than in
ffmpeg flags, which is why it was spiked before it was built.

## What the spike established

Each point was measured on macOS 26.5 with a throwaway build before the production
code was written; each was a design assumption that could have failed.

- An aggregate whose sub-device list is `[mic]` and whose tap list is `[tap]`
  starts, and the tap buffer carries audio (a 440 Hz tone played through the
  default output arrived at -38 dBFS mean).
- With `kAudioAggregateDeviceTapAutoStartKey` false, cycles fire in silence and
  the tap buffer is **full-size zeros**: 2048 bytes per 512-frame cycle, not
  `mDataByteSize 0` and not an absent callback. So no padding timer is needed; the
  one in the stream mode exists only because there the tap is the sole member of
  its aggregate. (Auto-start true also fired in silence here; false is kept
  because the SDK header says true may wait for a tapped process to play.)
- IO proc buffer order and count match `kAudioDevicePropertyStreamConfiguration`
  on the aggregate: the mic's streams first (`[2]` for a stereo USB codec), then
  one buffer per tap (`[1]`). `voxtap` reads the layout once at start and refuses
  a shape it does not recognise rather than assuming it.
- With the microphone's nominal rate set to 44.1 kHz it becomes the aggregate's
  rate, and the tap (natively 48 kHz) still delivers exactly the mic's frame count
  every cycle (258 cycles, 0 mismatches). ExtAudioFile resamples both to 16 kHz
  cleanly - the tone's level is identical to the 48 kHz run.
- `ExtAudioFileWriteAsync` from the IO block works once primed with a zero-frame
  call from the main thread; 0 write errors over every run, and `ExtAudioFileDispose`
  finalises the RIFF header, so the two files come out with **identical**
  durations (3.040 s and 3.040 s).
- A global process tap follows a default-output switch on its own: with the
  output switched to the built-in speakers mid-capture and back two seconds
  later, the tone resumed in the tap both times, with about a second of zeros
  while the player re-routed. No rebuild on that event is needed when the output
  device is not a sub-device.
- TCC attributes the microphone to the responsible process (the terminal), not
  to the binary: a never-before-seen ad-hoc-signed spike binary recorded the
  microphone with no prompt, so a rebuilt `voxtap` does not re-prompt.
- Signals: a `DispatchSourceSignal` held in a block-local is released after its
  last use and thereby cancelled, so SIGINT was ignored until the sources moved
  to a process-lifetime global. The stream mode always had them global, and its
  own stop path was never exercised by `vox` (it died by SIGPIPE).

## Consequences

- One capture pid in the statefile; `vox stop` signals it and waits for it, and
  `_vox_halt` is otherwise unchanged. Stop stays SIGINT (TERM works too:
  `voxtap` finalises on either), so the contract mw depends on holds.
- `vox` no longer needs ffmpeg to start; it stays for `volumedetect`, `compact`
  and `play`. `VOX_MIC_ONLY=1` records through `voxtap record --no-sys`, so a
  machine without the helper cannot record at all - per ADR 0003's own argument
  against a second backend.
- The microphone is chosen by HAL name (case-insensitive substring, or an exact
  UID), never by a stored index. HAL names equal avfoundation's, so the default
  `Microphone` selects the same device it always did.
- A microphone that goes away mid-recording (`DeviceIsAlive` false) is rebuilt
  through the same selection rule, ten attempts a second apart; failing that the
  files are finalised and the process exits 1, so the pid's death is what the pill
  reads. A replacement at another sample rate is refused rather than written at
  the wrong pitch.
- First run after `drs`: take the microphone TCC prompt in the foreground with
  `voxtap --probe 1`, because a detached first start would sit behind the prompt
  until the 10 s wait expired. The grant persists.
- The findings that shaped ADR 0003's code - the tap blocking avfoundation from
  opening, one ffmpeg starving one input, `pan` over `-ac 1`, no `-t`, the mic
  resolved by name at start - describe a path that no longer exists; they are
  history, recorded there.
