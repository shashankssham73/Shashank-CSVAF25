// poke.swift — deliver one mouse event to one application.
//
// A piece of the collage shows a window that may be buried under the collage
// itself. Posting a click at those screen coordinates would land on whatever
// is on top, which is us. CGEvent.postToPid delivers the event to a named
// process instead, so the window receives it wherever it sits in the stack.
//
// Deliberately one event per invocation, with no loop, no recording and no
// keyboard: it exists so a piece of the sheet can be clicked through to the
// window inside it, and it can do nothing else.
//
//   poke --pid 1234 --x 820 --y 410 --type click
//   poke --pid 1234 --x 820 --y 410 --type scroll --dy -3
//
// Needs Accessibility permission, the same grant the screen reader uses.

import Foundation
import CoreGraphics
import AppKit

func arg(_ n: String) -> String? {
    let a = CommandLine.arguments
    guard let i = a.firstIndex(of: "--" + n), i + 1 < a.count else { return nil }
    return a[i + 1]
}

_ = NSApplication.shared          // CoreGraphics event services need this

guard let pidS = arg("pid"), let pid = Int32(pidS),
      let xS = arg("x"), let x = Double(xS),
      let yS = arg("y"), let y = Double(yS) else {
    FileHandle.standardError.write("poke: --pid --x --y are required\n".data(using: .utf8)!)
    exit(2)
}
let kind = arg("type") ?? "click"
let pt = CGPoint(x: x, y: y)
let src = CGEventSource(stateID: .hidSystemState)

func post(_ e: CGEvent?) {
    guard let e = e else { return }
    // To the process, not to the screen position — the window is very likely
    // underneath the thing showing it.
    e.postToPid(pid)
}

switch kind {
case "move":
    post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved,
                 mouseCursorPosition: pt, mouseButton: .left))
case "down":
    post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDown,
                 mouseCursorPosition: pt, mouseButton: .left))
case "up":
    post(CGEvent(mouseEventSource: src, mouseType: .leftMouseUp,
                 mouseCursorPosition: pt, mouseButton: .left))
case "scroll":
    let dy = Int32(Double(arg("dy") ?? "0") ?? 0)
    if let e = CGEvent(scrollWheelEvent2Source: src, units: .line,
                       wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0) {
        e.location = pt
        e.postToPid(pid)
    }
case "click":
    // Move first: many apps decide what a click means from where the pointer
    // was, and a click with no preceding move lands on whatever the app last
    // thought was hovered.
    post(CGEvent(mouseEventSource: src, mouseType: .mouseMoved,
                 mouseCursorPosition: pt, mouseButton: .left))
    post(CGEvent(mouseEventSource: src, mouseType: .leftMouseDown,
                 mouseCursorPosition: pt, mouseButton: .left))
    usleep(12_000)
    post(CGEvent(mouseEventSource: src, mouseType: .leftMouseUp,
                 mouseCursorPosition: pt, mouseButton: .left))
default:
    FileHandle.standardError.write("poke: unknown type \(kind)\n".data(using: .utf8)!)
    exit(2)
}
exit(0)
