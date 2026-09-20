// voxtap — the capture engine for vox: microphone and system audio, one process.
//
//   voxtap record <dir> [--mic <name>] [--no-sys]
//                     capture the microphone and the system's own output through
//                     ONE aggregate device into <dir>/mic.wav and <dir>/sys.wav
//                     (16 kHz mono int16), until SIGINT/SIGTERM
//   voxtap --probe N [--mic <name>] [--no-sys]
//                     run the same aggregate for N seconds, write nothing, report
//                     frames + elapsed + levels on stderr
//
// System audio comes from a Core Audio process tap (macOS 14.2+): no loopback
// driver, no Multi-Output device, no default-output switch. ffmpeg's avfoundation
// input cannot use the tap API, and resolving a microphone for it means listing
// every capture device first, which is where most of a recording's start-up went.
//
// The microphone and the tap live in one aggregate device with the microphone as
// its clock master. One IO cycle then delivers one buffer per mic stream followed
// by one tap buffer, all for the same frames, so the two tracks are aligned by
// construction: no second clock, no padding timer, no start-order gate between
// two processes. Measured before it was built (docs/adr/0012): the tap buffer
// through silence is zeros of full size, not empty and not absent; with a
// 44.1 kHz microphone as master the tap still delivers exactly the mic's frame
// count per cycle; and a global tap follows a default-output switch on its own,
// so nothing here rebuilds on that event.
//
// --mic takes a case-insensitive substring of the device's name, or its exact
// UID; HAL names equal avfoundation's, so the name vox has always passed
// resolves to the same device. Without it the default input is used.

import AudioToolbox
import CoreAudio
import Darwin
import Foundation

// --- output contract ----------------------------------------------------------

let bytesPerSample = MemoryLayout<Float>.size

/// The stored track format: what mw is handed, and what the ffmpeg path this
/// replaces wrote, so everything downstream (transcription, compact, prune,
/// play) is unchanged.
let fileRate: Double = 16000

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

struct CaptureOptions {
    /// Substring of the input device's name (or its exact UID); nil = default input.
    var mic: String?
    var sys = true
}

enum Mode {
    case probe(Double, CaptureOptions)
    case record(String, CaptureOptions)
}

let usage =
    "usage: voxtap record <dir> [--mic <name>] [--no-sys] | --probe <seconds> [--mic <name>] [--no-sys]"

/// The trailing `--mic` / `--no-sys` flags shared by record and probe.
func parseCaptureOptions(_ args: ArraySlice<String>) -> CaptureOptions {
    var options = CaptureOptions()
    var rest = args[...]
    while let flag = rest.first {
        rest = rest.dropFirst()
        switch flag {
        case "--mic":
            guard let name = rest.first, !name.isEmpty else { die(usage) }
            rest = rest.dropFirst()
            options.mic = name
        case "--no-sys":
            options.sys = false
        default:
            die(usage)
        }
    }
    return options
}

func parseMode() -> Mode {
    let args = Array(CommandLine.arguments.dropFirst())
    switch args.first {
    case "--probe":
        guard args.count >= 2, let seconds = Double(args[1]), seconds > 0 else { die(usage) }
        return .probe(seconds, parseCaptureOptions(args[2...]))
    case "record":
        guard args.count >= 2, !args[1].isEmpty, !args[1].hasPrefix("--") else { die(usage) }
        return .record(args[1], parseCaptureOptions(args[2...]))
    default:
        die(usage)
    }
}

let mode = parseMode()

// --- Core Audio ---------------------------------------------------------------

struct CaptureError: Error {
    let message: String
    let status: OSStatus?
}

func fail(_ message: String, _ status: OSStatus? = nil) -> CaptureError {
    CaptureError(message: message, status: status)
}

func describe(_ error: Error) -> String {
    guard let captureError = error as? CaptureError else { return "\(error)" }
    guard let status = captureError.status else { return captureError.message }
    return "\(captureError.message) (OSStatus \(status))"
}

func address(
    _ selector: AudioObjectPropertySelector,
    _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal
) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(
        mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var property = address(selector)
    var value: CFString = "" as CFString
    var size = UInt32(MemoryLayout<CFString>.size)
    let err = withUnsafeMutablePointer(to: &value) { pointer in
        AudioObjectGetPropertyData(object, &property, 0, nil, &size, pointer)
    }
    return err == noErr ? (value as String) : nil
}

func readDouble(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Double? {
    var property = address(selector)
    var value: Double = 0
    var size = UInt32(MemoryLayout<Double>.size)
    return AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value) == noErr ? value : nil
}

func readObjectID(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> AudioObjectID? {
    var property = address(selector)
    var value = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let err = AudioObjectGetPropertyData(object, &property, 0, nil, &size, &value)
    return err == noErr && value != kAudioObjectUnknown ? value : nil
}

func readObjectIDs(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
    var property = address(selector)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(object, &property, 0, nil, &size) == noErr else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(object, &property, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

/// Channels per buffer in a device's stream configuration for one scope — the
/// shape its IO proc will hand over, one AudioBuffer per stream.
func streamChannels(_ object: AudioObjectID, _ scope: AudioObjectPropertyScope) -> [Int] {
    var property = address(kAudioDevicePropertyStreamConfiguration, scope)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(object, &property, 0, nil, &size) == noErr, size > 0 else {
        return []
    }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: 8)
    defer { raw.deallocate() }
    guard AudioObjectGetPropertyData(object, &property, 0, nil, &size, raw) == noErr else { return [] }
    let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
    return list.map { Int($0.mNumberChannels) }
}

func tapFormat(_ tap: AudioObjectID) throws -> AudioStreamBasicDescription {
    var property = address(kAudioTapPropertyFormat)
    var asbd = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    let err = AudioObjectGetPropertyData(tap, &property, 0, nil, &size, &asbd)
    guard err == noErr else { throw fail("could not read tap format", err) }
    return asbd
}

/// A global tap excluding nothing is the whole system's output. Mono halves the
/// stream and loses nothing: speech is the payload, not stereo imaging.
func createTap() throws -> (id: AudioObjectID, uuid: UUID) {
    let description = CATapDescription(monoGlobalTapButExcludeProcesses: [])
    description.uuid = UUID()
    description.name = "voxtap"
    description.isPrivate = true
    description.muteBehavior = .unmuted
    var tap = AudioObjectID(kAudioObjectUnknown)
    let err = AudioHardwareCreateProcessTap(description, &tap)
    guard err == noErr, tap != kAudioObjectUnknown else {
        throw fail("AudioHardwareCreateProcessTap failed — is audio-capture permission granted?", err)
    }
    return (tap, description.uuid)
}

// --- the microphone -----------------------------------------------------------

struct InputDevice {
    let id: AudioObjectID
    let uid: String
    let name: String
    /// Channels per input stream, i.e. one entry per buffer its IO proc yields.
    let streams: [Int]
}

/// Every device with at least one input stream, in HAL order.
func inputDevices() -> [InputDevice] {
    readObjectIDs(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDevices).compactMap {
        id in
        let streams = streamChannels(id, kAudioObjectPropertyScopeInput)
        guard !streams.isEmpty, let uid = readString(id, kAudioDevicePropertyDeviceUID) else {
            return nil
        }
        return InputDevice(
            id: id, uid: uid, name: readString(id, kAudioObjectPropertyName) ?? uid,
            streams: streams)
    }
}

/// The microphone: an exact UID, else the first input whose name contains the
/// selector case-insensitively, else the default input when there is no
/// selector. Resolved at start, never stored: device ids and orderings change
/// as devices come and go.
func resolveMic(_ selector: String?) throws -> InputDevice {
    let inputs = inputDevices()
    guard let selector = selector else {
        guard
            let id = readObjectID(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultInputDevice),
            let device = inputs.first(where: { $0.id == id })
        else { throw fail("no default input device") }
        return device
    }
    if let exact = inputs.first(where: { $0.uid == selector }) { return exact }
    let wanted = selector.lowercased()
    guard let match = inputs.first(where: { $0.name.lowercased().contains(wanted) }) else {
        throw fail("no audio input matching \"\(selector)\"")
    }
    return match
}

// --- the tracks ---------------------------------------------------------------

/// One stored track: an ExtAudioFile writing 16 kHz mono int16 WAV, fed float32
/// mono at the capture rate and resampled by Core Audio's converter. Written
/// from the IO thread with the async call, which hands the data to a worker
/// thread and returns; `ExtAudioFileDispose` flushes what is queued and writes
/// the RIFF sizes, which is what makes SIGINT a clean stop.
final class TrackWriter {
    private var ref: ExtAudioFileRef?
    let path: String

    init(path: String, captureRate: Double) throws {
        self.path = path
        var file = AudioStreamBasicDescription(
            mSampleRate: fileRate, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 2, mFramesPerPacket: 1, mBytesPerFrame: 2, mChannelsPerFrame: 1,
            mBitsPerChannel: 16, mReserved: 0)
        var created: ExtAudioFileRef?
        let err = ExtAudioFileCreateWithURL(
            URL(fileURLWithPath: path) as CFURL, kAudioFileWAVEType, &file, nil,
            AudioFileFlags.eraseFile.rawValue, &created)
        guard err == noErr, let handle = created else {
            throw fail("could not create \(path)", err)
        }
        var client = AudioStreamBasicDescription(
            mSampleRate: captureRate, mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
            mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 1,
            mBitsPerChannel: 32, mReserved: 0)
        let clientErr = ExtAudioFileSetProperty(
            handle, kExtAudioFileProperty_ClientDataFormat,
            UInt32(MemoryLayout<AudioStreamBasicDescription>.size), &client)
        guard clientErr == noErr else {
            ExtAudioFileDispose(handle)
            throw fail("could not set the client format for \(path)", clientErr)
        }
        // A zero-frame async write from a non-realtime thread is how the
        // documented priming works: it allocates the async machinery here so
        // the first call from the IO thread allocates nothing.
        let primeErr = ExtAudioFileWriteAsync(handle, 0, nil)
        guard primeErr == noErr else {
            ExtAudioFileDispose(handle)
            throw fail("could not prime \(path)", primeErr)
        }
        ref = handle
    }

    func write(_ samples: UnsafeMutablePointer<Float>, frames: Int) -> OSStatus {
        guard let handle = ref else { return noErr }
        var list = AudioBufferList(
            mNumberBuffers: 1,
            mBuffers: AudioBuffer(
                mNumberChannels: 1, mDataByteSize: UInt32(frames * bytesPerSample),
                mData: UnsafeMutableRawPointer(samples)))
        return ExtAudioFileWriteAsync(handle, UInt32(frames), &list)
    }

    func close() {
        if let handle = ref { ExtAudioFileDispose(handle) }
        ref = nil
    }
}

// --- the recorder -------------------------------------------------------------

/// The microphone and the tap in one aggregate device, the microphone as clock
/// master, one IO proc reading both. Buffers arrive as one per mic stream then
/// one for the tap (checked against the stream configuration at start), and every
/// cycle carries the same frame count in each, so the tracks stay aligned with
/// no clock of our own. The mic track is channel 0 of the first buffer, as the
/// ffmpeg `pan=mono|c0=c0` it replaces; the sys track is the tap buffer, mono at
/// source. Should the tap ever come up short in a cycle it is zero-filled to
/// the mic's frame count, so alignment holds by construction.
final class Recorder {
    private let options: CaptureOptions
    /// Where mic.wav and sys.wav go; nil for a probe, which measures and
    /// reports but writes nothing.
    private let dir: String?

    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private var micID = AudioObjectID(kAudioObjectUnknown)
    private var aliveListener: AudioObjectPropertyListenerBlock?
    private let queue = DispatchQueue(label: "voxtap.io")
    private let controlQueue = DispatchQueue(label: "voxtap.control")

    /// Capture rate: the aggregate's, i.e. the mic's. The writers' client format
    /// is fixed at this once they exist.
    private(set) var rate: Double = 0
    private var expectedBuffers = 0

    /// Preallocated so the IO thread never allocates; a cycle larger than this
    /// (no HAL device asks for it) is clamped and counted.
    private let capacity = 1 << 16
    private let micScratch: UnsafeMutablePointer<Float>
    private let sysScratch: UnsafeMutablePointer<Float>

    private let lock = NSLock()
    private var micWriter: TrackWriter?
    private var sysWriter: TrackWriter?
    private var writersLive = false
    private var writeFailures = 0
    private var cycles: UInt64 = 0
    private var micFrames: UInt64 = 0
    /// Frames the tap actually delivered, before any zero fill.
    private var sysFrames: UInt64 = 0
    private var clampedCycles: UInt64 = 0
    private var micPeak: Float = 0
    private var sysPeak: Float = 0
    private var sysSumSquares: Double = 0
    private var started = DispatchTime.now()
    private var stopped: DispatchTime?

    init(options: CaptureOptions, dir: String?) {
        self.options = options
        self.dir = dir
        micScratch = UnsafeMutablePointer<Float>.allocate(capacity: capacity)
        sysScratch = UnsafeMutablePointer<Float>.allocate(capacity: capacity)
    }

    /// Resolve the mic, build the tap and the aggregate, check the layout, start
    /// the device, then (record mode) create sys.wav then mic.wav - mic last, so
    /// its existence implies both - and publish the writers to the IO thread.
    /// Any failure tears down what was built and leaves no files.
    func start() throws {
        try startCapture()
        guard let dir = dir else { return }
        do {
            let sys = options.sys ? try TrackWriter(path: dir + "/sys.wav", captureRate: rate) : nil
            let mic = try TrackWriter(path: dir + "/mic.wav", captureRate: rate)
            lock.lock()
            sysWriter = sys
            micWriter = mic
            writersLive = true
            lock.unlock()
        } catch {
            stopCapture()
            throw error
        }
    }

    private func startCapture() throws {
        let mic = try resolveMic(options.mic)
        micID = mic.id

        var tapUUID: UUID?
        var format = AudioStreamBasicDescription()
        if options.sys {
            let tap = try createTap()
            tapID = tap.id
            tapUUID = tap.uuid
            format = try tapFormat(tap.id)
        }

        // Private, so it never appears in Sound preferences or in another app's
        // device list. The mic is the only sub-device and the main one: a real
        // hardware clock that runs whether or not anything is playing. No
        // auto-start: with it the SDK header says AudioDeviceStart waits for a
        // tapped process to play, and a recording must start when asked. Drift
        // compensation on the tap slaves it to that clock.
        var aggregate: [String: Any] = [
            kAudioAggregateDeviceNameKey: "voxtap",
            kAudioAggregateDeviceUIDKey: UUID().uuidString,
            kAudioAggregateDeviceMainSubDeviceKey: mic.uid,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: false,
            kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: mic.uid]],
        ]
        if let uuid = tapUUID {
            aggregate[kAudioAggregateDeviceTapListKey] = [
                [
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: uuid.uuidString,
                ]
            ]
        }
        var device = AudioObjectID(kAudioObjectUnknown)
        let aggregateErr = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device)
        guard aggregateErr == noErr, device != kAudioObjectUnknown else {
            stopCapture()
            throw fail("AudioHardwareCreateAggregateDevice failed", aggregateErr)
        }
        aggregateID = device

        // The layout the IO proc will see, read once rather than assumed: mic
        // streams first (sub-device order), then one buffer per tap.
        let layout = streamChannels(device, kAudioObjectPropertyScopeInput)
        let expected = mic.streams.count + (options.sys ? 1 : 0)
        guard layout.count == expected, !layout.isEmpty, layout[0] > 0 else {
            stopCapture()
            throw fail("unexpected aggregate layout \(layout) for mic streams \(mic.streams)")
        }
        if options.sys {
            guard layout[layout.count - 1] == Int(format.mChannelsPerFrame) else {
                stopCapture()
                throw fail("tap buffer has \(layout[layout.count - 1]) channels, tap format says \(format.mChannelsPerFrame)")
            }
        }
        expectedBuffers = expected
        let captureRate = readDouble(device, kAudioDevicePropertyNominalSampleRate)
            ?? readDouble(mic.id, kAudioDevicePropertyNominalSampleRate) ?? 0
        guard captureRate > 0 else {
            stopCapture()
            throw fail("could not read the capture rate")
        }
        if rate == 0 {
            rate = captureRate
        } else if abs(rate - captureRate) > 0.5 {
            // The writers' client format is fixed; a device at another rate
            // would be written at the wrong pitch.
            stopCapture()
            throw fail(String(format: "%@ runs at %.0f Hz, recording is at %.0f Hz", mic.name, captureRate, rate))
        }

        var proc: AudioDeviceIOProcID?
        let ioErr = AudioDeviceCreateIOProcIDWithBlock(&proc, device, queue) {
            [unowned self] _, input, _, _, _ in
            self.cycle(UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input)))
        }
        guard ioErr == noErr, let created = proc else {
            stopCapture()
            throw fail("AudioDeviceCreateIOProcIDWithBlock failed", ioErr)
        }
        procID = created

        lock.lock()
        started = DispatchTime.now()
        stopped = nil
        lock.unlock()
        let startErr = AudioDeviceStart(device, created)
        guard startErr == noErr else {
            stopCapture()
            throw fail("AudioDeviceStart failed", startErr)
        }
        watchMic(mic)
        if options.sys {
            log(
                String(
                    format: "capturing %@ at %.0f Hz + system audio (tap %.0f Hz, %u ch)", mic.name,
                    captureRate, format.mSampleRate, format.mChannelsPerFrame))
        } else {
            log(String(format: "capturing %@ at %.0f Hz, mic only", mic.name, captureRate))
        }
    }

    /// One IO cycle. No allocation, no logging: copy the mic's first channel and
    /// the tap's (averaged) channels into the scratch buffers, zero-fill a short
    /// tap, hand both to the writers.
    private func cycle(_ buffers: UnsafeMutableAudioBufferListPointer) {
        guard buffers.count >= expectedBuffers, expectedBuffers > 0 else { return }
        let micBuffer = buffers[0]
        guard let micData = micBuffer.mData else { return }
        let micChannels = Int(micBuffer.mNumberChannels)
        guard micChannels > 0 else { return }
        let available = Int(micBuffer.mDataByteSize) / bytesPerSample / micChannels
        let frames = min(available, capacity)
        guard frames > 0 else { return }
        let mic = micData.assumingMemoryBound(to: Float.self)
        var micMax: Float = 0
        for n in 0..<frames {
            let value = mic[n * micChannels]
            micScratch[n] = value
            micMax = max(micMax, abs(value))
        }

        var delivered = 0
        var sysMax: Float = 0
        var sysSquares: Double = 0
        if options.sys {
            let tapBuffer = buffers[buffers.count - 1]
            let channels = Int(tapBuffer.mNumberChannels)
            if let tapData = tapBuffer.mData, channels > 0 {
                let tap = tapData.assumingMemoryBound(to: Float.self)
                delivered = min(Int(tapBuffer.mDataByteSize) / bytesPerSample / channels, frames)
                for n in 0..<delivered {
                    var sum: Float = 0
                    for c in 0..<channels { sum += tap[n * channels + c] }
                    let value = sum / Float(channels)
                    sysScratch[n] = value
                    sysMax = max(sysMax, abs(value))
                    sysSquares += Double(value) * Double(value)
                }
            }
            if delivered < frames {
                for n in delivered..<frames { sysScratch[n] = 0 }
            }
        }

        lock.lock()
        defer { lock.unlock() }
        cycles += 1
        micFrames += UInt64(frames)
        sysFrames += UInt64(delivered)
        if available > capacity { clampedCycles += 1 }
        micPeak = max(micPeak, micMax)
        sysPeak = max(sysPeak, sysMax)
        sysSumSquares += sysSquares
        guard writersLive else { return }
        var err = micWriter?.write(micScratch, frames: frames) ?? noErr
        if err == noErr, let sys = sysWriter {
            err = sys.write(sysScratch, frames: frames)
        }
        if err != noErr { writeFailures += 1 }
    }

    /// Follow the microphone's `DeviceIsAlive`: a USB mic unplugged mid-call
    /// would otherwise stop the aggregate silently, with the process alive and
    /// the pill still reading RECORDING. Rebuild through the same selection
    /// rule, a bounded number of times; failing that, finish the files and
    /// exit 1, so the pid's death is what says the recording stopped.
    private func watchMic(_ mic: InputDevice) {
        var alive = address(kAudioDevicePropertyDeviceIsAlive)
        let listener: AudioObjectPropertyListenerBlock = { [unowned self] _, _ in
            var property = address(kAudioDevicePropertyDeviceIsAlive)
            var value: UInt32 = 1
            var size = UInt32(MemoryLayout<UInt32>.size)
            let err = AudioObjectGetPropertyData(mic.id, &property, 0, nil, &size, &value)
            guard err != noErr || value == 0 else { return }
            log("\(mic.name) went away — rebuilding the capture")
            self.rebuild(attempt: 1)
        }
        aliveListener = listener
        AudioObjectAddPropertyListenerBlock(mic.id, &alive, controlQueue, listener)
    }

    private func unwatchMic() {
        guard let listener = aliveListener, micID != kAudioObjectUnknown else { return }
        var alive = address(kAudioDevicePropertyDeviceIsAlive)
        AudioObjectRemovePropertyListenerBlock(micID, &alive, controlQueue, listener)
        aliveListener = nil
    }

    private func rebuild(attempt: Int) {
        stopCapture()
        do {
            try startCapture()
        } catch {
            log("rebuild attempt \(attempt) failed: \(describe(error))")
            guard attempt < 10 else {
                log("giving up — the recording ends here")
                closeWriters()
                exit(1)
            }
            controlQueue.asyncAfter(deadline: .now() + 1) { self.rebuild(attempt: attempt + 1) }
        }
    }

    /// Idempotent, so it doubles as the cleanup path for a half-built capture.
    /// The writers are left alone: a rebuild keeps writing to the same files.
    func stopCapture() {
        unwatchMic()
        if let proc = procID, aggregateID != kAudioObjectUnknown {
            AudioDeviceStop(aggregateID, proc)
            AudioDeviceDestroyIOProcID(aggregateID, proc)
        }
        lock.lock()
        if stopped == nil { stopped = DispatchTime.now() }
        lock.unlock()
        procID = nil
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
        micID = AudioObjectID(kAudioObjectUnknown)
    }

    /// Finish the files: the IO thread stops writing first, then dispose flushes
    /// the queued async writes and writes the RIFF sizes.
    func closeWriters() {
        lock.lock()
        writersLive = false
        let mic = micWriter
        let sys = sysWriter
        micWriter = nil
        sysWriter = nil
        let failures = writeFailures
        lock.unlock()
        mic?.close()
        sys?.close()
        if failures > 0 { log("\(failures) write(s) failed — see the tracks' lengths") }
    }

    func stop() {
        stopCapture()
        closeWriters()
    }

    /// Both halves of the alignment invariant and the levels behind them.
    func report() -> String {
        lock.lock()
        defer { lock.unlock() }
        let end = stopped ?? DispatchTime.now()
        let elapsed = Double(end.uptimeNanoseconds - started.uptimeNanoseconds) / 1_000_000_000
        let rms = micFrames > 0 ? (sysSumSquares / Double(micFrames)).squareRoot() : 0
        let sysMean = rms > 0 ? 20 * log10(rms) : -120
        return String(
            format:
                "mic_frames: %llu  sys_frames: %llu  cycles: %llu  elapsed: %.3f  rate: %.0f  mic_peak: %.4f  sys_mean: %.1f dBFS  sys_peak: %.4f  clamped: %llu",
            micFrames, sysFrames, cycles, elapsed, rate, micPeak, sysMean, sysPeak, clampedCycles)
    }
}

// --- entry --------------------------------------------------------------------

// DispatchSource rather than signal(): a C function pointer cannot capture the
// object teardown needs. Held in a global for the life of the process: Swift
// releases a local after its LAST USE, not at scope end, and a released
// DispatchSource is cancelled - so sources held in a block-local `let` were gone
// before the run loop started and a SIGINT was silently ignored.
var signalSources: [DispatchSourceSignal] = []

func onSignals(_ handler: @escaping () -> Void) -> [DispatchSourceSignal] {
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    let signalQueue = DispatchQueue(label: "voxtap.signal")
    return [SIGINT, SIGTERM].map { number -> DispatchSourceSignal in
        let source = DispatchSource.makeSignalSource(signal: number, queue: signalQueue)
        source.setEventHandler(handler: handler)
        source.resume()
        return source
    }
}

switch mode {
case .record(let dir, let options):
    let recorder = Recorder(options: options, dir: dir)
    do {
        try recorder.start()
    } catch {
        // Refusing here is what lets `vox` refuse to start: a meeting half-captured
        // by accident is worse than one not started.
        die(describe(error))
    }
    signalSources = onSignals {
        recorder.stop()
        exit(0)
    }
    RunLoop.current.run()

case .probe(let seconds, let options):
    let recorder = Recorder(options: options, dir: nil)
    do {
        try recorder.start()
    } catch {
        die(describe(error))
    }
    Thread.sleep(forTimeInterval: seconds)
    recorder.stopCapture()
    log(recorder.report())
    exit(0)
}
