// voxtap — capture system audio via a Core Audio process tap and stream raw
// float32 PCM to stdout, at a fixed 48 kHz mono, for as long as it lives.
//
//   voxtap            stream 48 kHz mono float32 to stdout until killed
//   voxtap --check    create the tap, verify it starts, tear down, exit 0/1
//   voxtap --probe N  stream for N seconds, report frames + level on stderr
//
// Written because ffmpeg's avfoundation input cannot use the tap API: system
// audio only reaches it through BlackHole plus a hand-built Multi-Output device,
// a manual prerequisite whose absence records silence rather than an error. The
// tap needs no setup at all and captures whatever the default output plays.
//
// Two behaviours make it more than a pipe:
//
//   Silence padding. The tap delivers NO callbacks at all while nothing is
//   playing — not zeros, nothing — so a naive stream would compress every quiet
//   stretch out of existence and drift out of alignment with the mic track it is
//   merged against. A 100 ms timer tops the stream up to what the monotonic
//   clock says should have been emitted. Everything downstream can then assume
//   one second of stream is one second of wall-clock.
//
//   Rebuild on default-output change. The tap is bound to one output device, so
//   plugging in headphones would otherwise end the capture. A property listener
//   rebuilds it; the padder covers the gap, which is why no supervisor loop is
//   needed.
//
// The output format is fixed rather than reported, so the reader's ffmpeg flags
// (-f f32le -ar 48000 -ac 1) can be constants: a device running at another rate
// is downmixed and linearly resampled here.
//
// stdout is written with write(2), not FileHandle: a closed pipe must be a plain
// SIGPIPE death (the reader has gone, so has the reason to live), not an
// Objective-C exception with a stack trace.

import AudioToolbox
import CoreAudio
import Darwin
import Foundation

// --- output contract ----------------------------------------------------------

let targetRate: Double = 48000
let bytesPerSample = MemoryLayout<Float>.size

/// Emit the top-up only once the stream is this far behind wall-clock. Small
/// enough that a quiet stretch is padded promptly, large enough that ordinary
/// callback jitter does not inject zeros the next callback then pushes past.
let padThresholdFrames = Int(targetRate * 0.2)

// --- diagnostics --------------------------------------------------------------

func log(_ msg: String) {
    FileHandle.standardError.write("voxtap: \(msg)\n".data(using: .utf8)!)
}

func die(_ msg: String, _ status: OSStatus? = nil) -> Never {
    if let s = status {
        log("\(msg) (OSStatus \(s))")
    } else {
        log(msg)
    }
    exit(1)
}

// --- arguments ----------------------------------------------------------------

enum Mode {
    case stream
    case check
    case probe(Double)
}

func parseMode() -> Mode {
    let args = Array(CommandLine.arguments.dropFirst())
    switch args.first {
    case nil:
        return .stream
    case "--check":
        return .check
    case "--probe":
        guard args.count >= 2, let seconds = Double(args[1]), seconds > 0 else {
            die("usage: voxtap --probe <seconds>")
        }
        return .probe(seconds)
    default:
        die("usage: voxtap [--check | --probe <seconds>]")
    }
}

let mode = parseMode()
let writesToStdout: Bool
let isCheck: Bool
switch mode {
case .stream:
    writesToStdout = true
    isCheck = false
case .check:
    writesToStdout = false
    isCheck = true
case .probe:
    writesToStdout = false
    isCheck = false
}

// --- stdout -------------------------------------------------------------------

/// Write every byte or die. EINTR is retried; a closed pipe raises SIGPIPE,
/// which is left at its default disposition on purpose.
func writeAll(_ base: UnsafeRawPointer, _ bytes: Int) {
    var offset = 0
    while offset < bytes {
        let written = write(1, base.advanced(by: offset), bytes - offset)
        if written < 0 {
            if errno == EINTR { continue }
            die("write failed: \(String(cString: strerror(errno)))")
        }
        offset += written
    }
}

// --- mono @ targetRate conversion ---------------------------------------------

/// Converts one tap's interleaved float frames to mono at `targetRate`.
///
/// A global mono tap on a 48 kHz device needs none of this, which is the common
/// case and stays a straight passthrough. It exists for the others — a 44.1 kHz
/// DAC, or a rebuild that lands on a device with a different rate mid-recording,
/// where changing the output format would break the reader's fixed flags.
final class Converter {
    let sourceRate: Double
    let channels: Int
    let isPassthrough: Bool

    /// Position of the next output sample in the current input buffer's index
    /// space; may be negative, meaning "between the last frame of the previous
    /// buffer and the first of this one".
    private var phase: Double = 0
    private var previous: Float = 0
    private var mono: [Float] = []
    private var out: [Float] = []

    init(sourceRate: Double, channels: Int) {
        self.sourceRate = sourceRate > 0 ? sourceRate : targetRate
        self.channels = max(1, channels)
        isPassthrough = self.channels == 1 && abs(self.sourceRate - targetRate) < 0.5
    }

    /// Linear interpolation, with index -1 reaching back into the previous
    /// buffer so buffer boundaries introduce no discontinuity.
    private func sample(at position: Double) -> Float {
        let index = Int(floor(position))
        let fraction = Float(position - Double(index))
        let left = index < 0 ? previous : mono[index]
        let rightIndex = index + 1
        let right = rightIndex < mono.count ? mono[rightIndex] : left
        return left + (right - left) * fraction
    }

    /// Returns the converted mono samples for one input buffer. The array is
    /// reused between calls, so the caller must consume it before the next one.
    func convert(_ input: UnsafePointer<Float>, frames: Int) -> [Float] {
        mono.removeAll(keepingCapacity: true)
        mono.reserveCapacity(frames)
        if channels == 1 {
            mono.append(contentsOf: UnsafeBufferPointer(start: input, count: frames))
        } else {
            for frame in 0..<frames {
                var sum: Float = 0
                for channel in 0..<channels { sum += input[frame * channels + channel] }
                mono.append(sum / Float(channels))
            }
        }

        out.removeAll(keepingCapacity: true)
        let ratio = sourceRate / targetRate
        let last = Double(mono.count) - 1
        while phase <= last {
            out.append(sample(at: phase))
            phase += ratio
        }
        phase -= Double(mono.count)
        previous = mono.isEmpty ? previous : mono[mono.count - 1]
        return out
    }
}

// --- stream state -------------------------------------------------------------

/// Everything the IO callback, the padder and the reporter share. One lock, held
/// across the write too, so the two producers cannot interleave a buffer.
final class Stream {
    private let lock = NSLock()
    private var framesEmitted: UInt64 = 0
    private var paddedFrames: UInt64 = 0
    private var sumSquares: Double = 0
    private var peak: Float = 0
    private let started = DispatchTime.now()
    /// Reused so padding allocates nothing per tick.
    private var silence = [Float](repeating: 0, count: 4096)

    /// Frames the monotonic clock says should have been emitted by now.
    /// `uptimeNanoseconds` does not advance while the machine sleeps, which is
    /// what we want: a closed lid pauses the mic capture too.
    private func expectedFrames() -> UInt64 {
        let elapsed = DispatchTime.now().uptimeNanoseconds - started.uptimeNanoseconds
        return UInt64(Double(elapsed) / 1_000_000_000 * targetRate)
    }

    func emit(_ samples: [Float]) {
        guard !samples.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        for value in samples {
            sumSquares += Double(value) * Double(value)
            peak = max(peak, abs(value))
        }
        framesEmitted += UInt64(samples.count)
        if writesToStdout {
            samples.withUnsafeBytes { writeAll($0.baseAddress!, $0.count) }
        }
    }

    /// Top the stream up to wall-clock with zeros. The tap delivers nothing at
    /// all while nothing is playing, so without this a quiet stretch simply
    /// vanishes and the two tracks stop lining up.
    func pad() {
        lock.lock()
        defer { lock.unlock() }
        let expected = expectedFrames()
        guard expected > framesEmitted else { return }
        var shortfall = Int(expected - framesEmitted)
        guard shortfall >= padThresholdFrames else { return }
        framesEmitted += UInt64(shortfall)
        paddedFrames += UInt64(shortfall)
        while shortfall > 0 {
            let chunk = min(shortfall, silence.count)
            if writesToStdout {
                silence.withUnsafeBytes { writeAll($0.baseAddress!, chunk * bytesPerSample) }
            }
            shortfall -= chunk
        }
    }

    /// frames, padded frames, mean level in dBFS, peak.
    func report() -> (UInt64, UInt64, Double, Float) {
        lock.lock()
        defer { lock.unlock() }
        let rms = framesEmitted > 0 ? (sumSquares / Double(framesEmitted)).squareRoot() : 0
        return (framesEmitted, paddedFrames, rms > 0 ? 20 * log10(rms) : -120, peak)
    }
}

let stream = Stream()

// --- Core Audio ---------------------------------------------------------------

struct CaptureError: Error {
    let message: String
    let status: OSStatus?
}

func fail(_ message: String, _ status: OSStatus? = nil) -> CaptureError {
    CaptureError(message: message, status: status)
}

func defaultOutputDevice() throws -> AudioObjectID {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var device = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let err = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device)
    guard err == noErr, device != kAudioObjectUnknown else {
        throw fail("no default output device", err)
    }
    return device
}

func deviceUID(_ device: AudioObjectID) throws -> String {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain)
    var uid: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let err = withUnsafeMutablePointer(to: &uid) { pointer in
        AudioObjectGetPropertyData(device, &address, 0, nil, &size, pointer)
    }
    guard err == noErr else { throw fail("could not read device UID", err) }
    return uid as String
}

/// One tap + its private aggregate device + the IO proc reading it. Recreated
/// wholesale on a default-output change: rebuilding is simpler than migrating,
/// and the padder makes the gap invisible downstream.
final class Capture {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var converter = Converter(sourceRate: targetRate, channels: 1)
    private let queue = DispatchQueue(label: "voxtap.io")

    func start() throws {
        let output = try defaultOutputDevice()
        let outputUID = try deviceUID(output)

        // A global tap excluding nothing is the whole system's output. Mono
        // halves the stream and loses nothing: speech is the payload, not
        // stereo imaging.
        let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.name = "voxtap"
        description.isPrivate = true
        description.muteBehavior = .unmuted

        var tap = AudioObjectID(kAudioObjectUnknown)
        let tapErr = AudioHardwareCreateProcessTap(description, &tap)
        guard tapErr == noErr, tap != kAudioObjectUnknown else {
            throw fail(
                "AudioHardwareCreateProcessTap failed — is audio-capture permission granted?",
                tapErr)
        }
        tapID = tap

        // Private, so it never appears in Sound preferences or in another app's
        // device list; auto-start so the tap runs as soon as the IO proc does.
        let aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "voxtap",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
            kAudioAggregateDeviceTapListKey: [
                [
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: description.uuid.uuidString,
                ]
            ],
        ]
        var device = AudioObjectID(kAudioObjectUnknown)
        let aggregateErr = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device)
        guard aggregateErr == noErr, device != kAudioObjectUnknown else {
            stop()
            throw fail("AudioHardwareCreateAggregateDevice failed", aggregateErr)
        }
        aggregateID = device

        let format = try tapFormat(tap)
        converter = Converter(
            sourceRate: format.mSampleRate, channels: Int(format.mChannelsPerFrame))

        var proc: AudioDeviceIOProcID?
        let converter = self.converter
        let ioErr = AudioDeviceCreateIOProcIDWithBlock(&proc, device, queue) {
            _, input, _, _, _ in
            let buffers = UnsafeMutableAudioBufferListPointer(
                UnsafeMutablePointer(mutating: input))
            guard let first = buffers.first, let data = first.mData else { return }
            let bytes = Int(first.mDataByteSize)
            guard bytes > 0 else { return }
            let samples = data.assumingMemoryBound(to: Float.self)
            let frames = bytes / bytesPerSample / converter.channels
            stream.emit(
                converter.isPassthrough
                    ? Array(UnsafeBufferPointer(start: samples, count: frames))
                    : converter.convert(samples, frames: frames))
        }
        guard ioErr == noErr, let created = proc else {
            stop()
            throw fail("AudioDeviceCreateIOProcIDWithBlock failed", ioErr)
        }
        procID = created

        let startErr = AudioDeviceStart(device, created)
        guard startErr == noErr else {
            stop()
            throw fail("AudioDeviceStart failed", startErr)
        }
        // --check answers one question with its exit status; a line about a tap
        // it is about to tear down is noise on the caller's terminal.
        if !isCheck {
            log(
                String(
                    format: "capturing %@ — tap %.0f Hz, %u ch", outputUID, format.mSampleRate,
                    format.mChannelsPerFrame))
        }
    }

    /// Idempotent, so it doubles as the cleanup path for a half-built capture.
    func stop() {
        if let proc = procID, aggregateID != kAudioObjectUnknown {
            AudioDeviceStop(aggregateID, proc)
            AudioDeviceDestroyIOProcID(aggregateID, proc)
        }
        procID = nil
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }

    private func tapFormat(_ tap: AudioObjectID) throws -> AudioStreamBasicDescription {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        let err = AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &asbd)
        guard err == noErr else { throw fail("could not read tap format", err) }
        return asbd
    }
}

let capture = Capture()

func describe(_ error: Error) -> String {
    guard let captureError = error as? CaptureError else { return "\(error)" }
    guard let status = captureError.status else { return captureError.message }
    return "\(captureError.message) (OSStatus \(status))"
}

do {
    try capture.start()
} catch {
    // Refusing here is what lets `vox` refuse to start: a meeting half-captured
    // by accident is worse than one not started.
    die(describe(error))
}

if case .check = mode {
    capture.stop()
    exit(0)
}

// --- default-output changes ---------------------------------------------------

let controlQueue = DispatchQueue(label: "voxtap.control")

/// Rebuild after the default output changes. Retried a bounded number of times
/// because a device swap can leave the new default briefly unusable; once the
/// attempts are spent the stream continues as padded silence rather than dying,
/// so the recording that is already on disk stays intact.
func rebuild(attempt: Int = 1) {
    capture.stop()
    do {
        try capture.start()
    } catch {
        log("rebuild attempt \(attempt) failed: \(describe(error))")
        guard attempt < 10 else {
            log("giving up on rebuild — system audio is silence from here")
            return
        }
        controlQueue.asyncAfter(deadline: .now() + 1) { rebuild(attempt: attempt + 1) }
    }
}

var defaultOutputAddress = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultOutputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
AudioObjectAddPropertyListenerBlock(
    AudioObjectID(kAudioObjectSystemObject), &defaultOutputAddress, controlQueue
) { _, _ in
    log("default output changed — rebuilding the tap")
    rebuild()
}

// --- padding timer ------------------------------------------------------------

let padTimer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "voxtap.pad"))
padTimer.schedule(deadline: .now() + 0.1, repeating: 0.1)
padTimer.setEventHandler { stream.pad() }
padTimer.resume()

// --- shutdown -----------------------------------------------------------------

// DispatchSource rather than signal(): a C function pointer cannot capture the
// object teardown needs.
signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
let signalQueue = DispatchQueue(label: "voxtap.signal")
let signalSources = [SIGINT, SIGTERM].map { number -> DispatchSourceSignal in
    let source = DispatchSource.makeSignalSource(signal: number, queue: signalQueue)
    source.setEventHandler {
        capture.stop()
        exit(0)
    }
    source.resume()
    return source
}
_ = signalSources

if case .probe(let seconds) = mode {
    Thread.sleep(forTimeInterval: seconds)
    let (frames, padded, meanDB, peak) = stream.report()
    capture.stop()
    log(
        String(
            format: "frames: %llu  padded: %llu  mean: %.1f dBFS  peak: %.4f",
            frames, padded, meanDB, peak))
    exit(0)
}

RunLoop.current.run()
