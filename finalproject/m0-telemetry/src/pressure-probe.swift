// pressure-probe.swift — emits NDJSON of trackpad/mouse input to stdout.
// The only part of M0 that needs native code: NSEvent.pressure is the
// continuous 0.0–1.0 Force Touch signal, unavailable from any CLI tool.
//
//   swiftc -O -o bin/pressure-probe src/pressure-probe.swift -framework AppKit
//
// THREE MODES, because macOS does not deliver pressure the way you'd hope:
//
//   (default) --global   NSEvent global monitor.  No permission needed.
//                        Gets move/scroll/click system-wide.  Does NOT get
//                        .pressure events, and `pressure` on mouse events is
//                        binary 0/1, not analog.  (Verified empirically.)
//
//   --window             Opens a small floating window and uses a LOCAL
//                        monitor.  Force-touch inside the window to get true
//                        analog pressure 0.0–1.0 plus stage 0/1/2.  This is the
//                        path a real app uses — pressure belongs to the app
//                        under the cursor.
//
//   --tap                CGEventTap, system-wide analog pressure.  REQUIRES
//                        Accessibility permission (System Settings > Privacy &
//                        Security > Accessibility).  Exits with a diagnostic
//                        if the tap cannot be created.

import AppKit
import Foundation

let out = FileHandle.standardOutput
let t0 = Date().timeIntervalSince1970
let args = Set(CommandLine.arguments.dropFirst())
let useTap = args.contains("--tap")
let useWindow = args.contains("--window")

@inline(__always)
func emit(_ d: [String: Any]) {
    guard let j = try? JSONSerialization.data(withJSONObject: d, options: []) else { return }
    out.write(j); out.write(Data([0x0a]))
}

var lastMotionEmit: Double = 0
let motionMinInterval: Double = 1.0 / 120.0     // cap motion at ~120 Hz

func handle(_ ev: NSEvent) {
    let now = Date().timeIntervalSince1970
    let loc = NSEvent.mouseLocation              // screen coords, origin bottom-left
    var d: [String: Any] = ["t": now - t0, "x": loc.x, "y": loc.y]

    switch ev.type {
    case .pressure:
        d["type"] = "pressure"
        d["pressure"] = Double(ev.pressure)          // 0.0 ... 1.0 CONTINUOUS
        d["stage"] = ev.stage                         // 0, 1, 2 detents
        d["stageTransition"] = Double(ev.stageTransition)
    case .scrollWheel:
        d["type"] = "scroll"
        d["dx"] = ev.scrollingDeltaX; d["dy"] = ev.scrollingDeltaY
        d["phase"] = ev.phase.rawValue                // began(1)/changed(4)/ended(8)
        d["momentumPhase"] = ev.momentumPhase.rawValue
        d["precise"] = ev.hasPreciseScrollingDeltas
    case .mouseMoved, .leftMouseDragged, .rightMouseDragged:
        if now - lastMotionEmit < motionMinInterval { return }
        lastMotionEmit = now
        d["type"] = "move"
        d["dx"] = ev.deltaX; d["dy"] = ev.deltaY
        d["pressure"] = Double(ev.pressure)
    case .leftMouseDown, .rightMouseDown:
        d["type"] = "down"; d["pressure"] = Double(ev.pressure); d["clickCount"] = ev.clickCount
    case .leftMouseUp, .rightMouseUp:
        d["type"] = "up"; d["pressure"] = Double(ev.pressure)
    default:
        return
    }
    emit(d)
}

let mask: NSEvent.EventTypeMask = [
    .mouseMoved, .leftMouseDragged, .rightMouseDragged, .scrollWheel, .pressure,
    .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
]

let app = NSApplication.shared

// ---------------------------------------------------------------- --tap
if useTap {
    let cb: CGEventTapCallBack = { _, _, cgEvent, _ in
        if let ns = NSEvent(cgEvent: cgEvent) { handle(ns) }
        return Unmanaged.passUnretained(cgEvent)
    }
    // NSEventTypePressure == 34; CGEventType has no symbolic case for it.
    let events: [CGEventType] = [.mouseMoved, .leftMouseDragged, .scrollWheel,
                                 .leftMouseDown, .leftMouseUp,
                                 CGEventType(rawValue: 34)!]
    let mask64 = events.reduce(UInt64(0)) { $0 | (1 << UInt64($1.rawValue)) }

    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                      options: .listenOnly, eventsOfInterest: mask64,
                                      callback: cb, userInfo: nil) else {
        emit(["type": "error", "t": 0.0,
              "msg": "CGEventTap creation failed — grant Accessibility permission to this binary's parent process (Terminal/VS Code) in System Settings > Privacy & Security > Accessibility, then rerun."])
        exit(2)
    }
    let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    emit(["type": "hello", "t": 0.0, "mode": "tap", "analogPressure": true])
    app.setActivationPolicy(.accessory)
    CFRunLoopRun()
    exit(0)
}

// ---------------------------------------------------------------- --window
final class PressureView: NSView {
    override var acceptsFirstResponder: Bool { true }
    override func pressureChange(with event: NSEvent) { handle(event); needsDisplay = true }
    override func mouseDown(with event: NSEvent) { handle(event) }
    override func mouseUp(with event: NSEvent) { handle(event) }
    override func mouseDragged(with event: NSEvent) { handle(event) }
    override func mouseMoved(with event: NSEvent) { handle(event) }
    override func scrollWheel(with event: NSEvent) { handle(event) }
    var p: CGFloat = 0
    override func draw(_ r: NSRect) {
        NSColor.black.setFill(); r.fill()
        let w = bounds.width * p
        NSColor.systemGreen.setFill(); NSRect(x: 0, y: 0, width: w, height: bounds.height).fill()
        let s = "force-touch here · p=\(String(format: "%.3f", Double(p)))"
        s.draw(at: NSPoint(x: 12, y: bounds.midY - 8),
               withAttributes: [.foregroundColor: NSColor.white,
                                .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)])
    }
}

final class Delegate: NSObject, NSApplicationDelegate {
    var win: NSWindow!
    func applicationDidFinishLaunching(_ n: Notification) {
        let v = PressureView(frame: NSRect(x: 0, y: 0, width: 340, height: 90))
        win = NSWindow(contentRect: v.frame, styleMask: [.titled, .closable],
                       backing: .buffered, defer: false)
        win.title = "pressure probe"
        win.contentView = v
        win.level = .floating
        win.acceptsMouseMovedEvents = true
        win.center(); win.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        // Local monitor: fires for events delivered to THIS app, with analog pressure.
        NSEvent.addLocalMonitorForEvents(matching: mask) { ev in
            if ev.type == .pressure { v.p = CGFloat(ev.pressure); v.needsDisplay = true }
            handle(ev); return ev
        }
        emit(["type": "hello", "t": 0.0, "mode": "window", "analogPressure": true])
    }
}

if useWindow {
    let d = Delegate()
    app.delegate = d
    app.setActivationPolicy(.regular)
    app.run()
    exit(0)
}

// ---------------------------------------------------------------- --global (default)
app.setActivationPolicy(.accessory)
NSEvent.addGlobalMonitorForEvents(matching: mask, handler: handle)
NSEvent.addLocalMonitorForEvents(matching: mask) { ev in handle(ev); return ev }
emit(["type": "hello", "t": 0.0, "mode": "global", "analogPressure": false,
      "note": "global monitors do not receive .pressure; use --window or --tap for analog force"])
app.run()
