import AppKit
import CoreGraphics

let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
DispatchQueue.global().async {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
}
var held = false
func emit(_ event: String) {
    print(event)
    fflush(stdout)
}
func cancel() {
    if held { held = false; emit("cancel") }
}
guard CGPreflightListenEventAccess() else {
    _ = CGRequestListenEventAccess()
    fputs("Enable Hex Command Keys in macOS Input Monitoring.\n", stderr)
    exit(2)
}
let mask = (CGEventMask(1) << CGEventType.keyDown.rawValue) | (CGEventMask(1) << CGEventType.keyUp.rawValue)
var eventTap: CFMachPort?
eventTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        cancel()
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    let key = event.getIntegerValueField(.keyboardEventKeycode)
    if key == 79 {
        if type == .keyDown && !held && event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
            guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "dev.bb.desktop" else { return Unmanaged.passUnretained(event) }
            held = true
            emit("start")
        } else if type == .keyUp && held {
            held = false
            emit("finish")
        }
    }
    if key == 53 && type == .keyDown { cancel() }
    return Unmanaged.passUnretained(event)
}, userInfo: nil)
guard let tap = eventTap else { fputs("Cannot listen for the command pedal. Check Input Monitoring.\n", stderr); exit(2) }
let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
let observer = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in held = false; emit("cancel") }
emit("ready")
application.run()
