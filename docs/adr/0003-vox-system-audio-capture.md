# 0003: vox captures system audio with a Core Audio process tap, in its own process

`vox` records the system's own output through
[`voxtap`](../../.config/nix/voxtap/main.swift), a Core Audio process tap, and gives
that tap **its own ffmpeg**, started only after the microphone capture is already
open. There is no loopback device, no fallback backend, and no single ffmpeg reading
both sources.

## Context

The recording is worth having only if it carries both sides of a conversation. The
original capture reached system audio the way most ffmpeg recipes do: BlackHole (a
loopback driver) plus a Multi-Output Device built by hand in Audio MIDI Setup, plus
switching the Mac's default output to it. That prerequisite did not exist on this
machine, so every `sys.wav` recorded silence - and silence is the monologue
classifier, so it read as "nobody else spoke" rather than as an error. The failure
was invisible by construction.

macOS 14.2 added a first-class answer: `AudioHardwareCreateProcessTap` captures what
any process is playing, with no routing and no driver. It is what MacWhisper and
every modern screen recorder use.

## Alternatives considered

**BlackHole + Multi-Output Device (the incumbent).** Loses on the manual
prerequisite alone: a recording that is silently half-captured whenever the default
output is wrong is the exact failure this subsystem exists to prevent. Headphones
become mandatory or the mic re-records the far side. HAL loopback capture through
AVFoundation has also been reported broken since Sequoia.

**Keeping BlackHole as a fallback when the tap is unavailable.** Two backends means
two failure modes, two sets of documentation, and a mode question at the moment you
want to start talking. `vox` instead refuses to start without the tap, with
`VOX_MIC_ONLY=1` as the deliberate, named escape hatch.

**ScreenCaptureKit audio capture.** Also gives system audio without routing, but it
is a *screen recording* API: it demands Screen Recording permission (a scarier
prompt than audio capture, and one that TCC resets on binary changes), and it drags
in a display-capture stack for an audio-only job.

**ffmpeg's avfoundation input reading the tap directly.** Not possible: the
avfoundation indev enumerates HAL input devices, and a process tap is not one.

**One ffmpeg reading both sources.** This was the design until it was measured. A
single ffmpeg schedules its inputs by timestamp, reading whichever is behind, and
the two sources start in different epochs - the mic at device uptime (or wall-clock
under `-use_wallclock_as_timestamps`), the raw pipe at zero. The input with the later
epoch is starved: **the mic delivered 2.0 s of audio over 8 s of wall-clock** while
the tap got 7.7 s. Putting wall-clock stamps on the pipe as well inverts it exactly -
mic 7.0 s, system track 0.26 s - which is the same trap already documented for `-t`.
`-thread_queue_size` changes nothing, because the constraint is scheduling, not
buffering. Two single-input ffmpegs have no cross-input scheduling at all: measured
5.5 s and 6.0 s over 8 s, both carrying real audio.

**A FIFO, or voxtap writing the WAV itself.** Both solve the ordering problem below,
and both cost more state: a file to clean up, or WAV muxing and resampling
reimplemented in Swift. Process substitution gives ffmpeg the pipe with no artefact
on disk, and voxtap reaps itself by `SIGPIPE` when its reader exits, so the system
capture needs no supervision.

## Two findings that shape the code

**A live tap blocks AVFoundation from opening an audio input.** Not from *running*
one - a capture already in flight keeps delivering across the tap's creation - but
`ffmpeg -f avfoundation -i :0` started while a tap exists blocks indefinitely, with
no error and no timeout. So the order is fixed: start the mic capture, wait for its
output file (ffmpeg opens outputs only once every input is open, so the file
appearing *is* "the mic is live"), and only then start the tap. Reversed, `vox`
hangs with nothing on disk.

**The tap delivers no callbacks at all through silence.** Not zeros - nothing: 0
bytes over 4 idle seconds. A dumb pipe would therefore compress every quiet stretch
out of existence and drift out of alignment with the mic. `voxtap` pads to a
monotonic clock on a 100 ms timer, which is also what covers the gap while it
rebuilds the tap after a default-output change.

## Consequences

- No setup: no driver, no Audio MIDI Setup device, no default-output switch, and
  headphones are optional rather than required.
- Two capture processes, so the statefile's first field is a comma-separated pid
  list, mic first. The mic capture is the leader: it defines RECORDING, and
  `vox stop` signals and waits for the whole set.
- The system track starts ~0.3 s after the mic (the tap's setup, after the gate) and
  both end together, so the two files differ slightly in length. That is a smaller
  and better-understood skew than the two-device clock drift the loopback design
  left unmeasured.
- `voxtap` is desktop-only, built from source by nix with the system `swiftc`, so a
  machine that has not run `drs` cannot record system audio - which `vox` reports
  rather than working around.

A tap and an input device can live in one aggregate device, which would give a
single process, a single clock and perfect alignment. That is the shape to revisit
if the ~0.3 s skew ever matters; it trades this design's small shell surface for
microphone capture written in Swift.
