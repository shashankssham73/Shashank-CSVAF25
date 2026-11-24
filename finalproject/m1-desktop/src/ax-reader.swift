// ax-reader.swift — the text on your screen, with its provenance.
//
// A screen capture is pixels. This is the other half: the Accessibility API
// gives the ROLE, the TEXT and the SCREEN RECTANGLE of every element in every
// running application, which is the structure a browser cannot reach and the
// only route to per-glyph typography on a real desktop.
//
// It also answers "how did this get here". Every element carries its own
// path down the hierarchy —
//
//     Finder > AXWindow > AXSplitGroup > AXScrollArea > AXStaticText
//
// — which is literally the provenance of that piece of text on screen: which
// application put it there, inside which window, nested in what.
//
// PERMISSION. This needs Accessibility, granted once in System Settings >
// Privacy & Security > Accessibility. Nothing here writes, clicks, types or
// reads keystrokes: it only reads the element tree that VoiceOver reads.
//
// COST. Each attribute read is an IPC round trip to the owning app, so a full
// walk is expensive and a deep one can stall on an unresponsive process.
// Hence the hard caps on elements, depth and wall-clock, and the fact that
// this is a one-shot command rather than a daemon: the caller decides how
// often it is worth paying for.
//
//   swiftc -O -o bin/ax-reader src/ax-reader.swift -framework AppKit

import Foundation
import AppKit
import ApplicationServices

func arg(_ n: String, _ d: String) -> String {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: "--" + n), i + 1 < a.count { return a[i + 1] }
    return d
}
func flag(_ n: String) -> Bool { CommandLine.arguments.contains("--" + n) }

let MAX_EL    = Int(arg("max", "900")) ?? 900
let MAX_DEPTH = Int(arg("depth", "16")) ?? 16
let BUDGET_MS = Double(arg("budget", "900")) ?? 900
let WANT_ALL  = flag("all")                 // every app with windows, not just the front one
let PROMPT    = flag("prompt")

// ---------------------------------------------------------------- helpers

func axCopy(_ e: AXUIElement, _ attr: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(e, attr as CFString, &v) == .success ? v : nil
}
func axStr(_ e: AXUIElement, _ attr: String) -> String? {
    guard let v = axCopy(e, attr) else { return nil }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n.stringValue }
    return nil
}
func axRect(_ e: AXUIElement) -> CGRect? {
    guard let p = axCopy(e, kAXPositionAttribute as String),
          let s = axCopy(e, kAXSizeAttribute as String) else { return nil }
    var pt = CGPoint.zero, sz = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &pt),
          AXValueGetValue(s as! AXValue, .cgSize, &sz) else { return nil }
    return CGRect(origin: pt, size: sz)
}
func esc(_ s: String) -> String {
    var o = ""
    for c in s.unicodeScalars {
        switch c {
        case "\"": o += "\\\""
        case "\\": o += "\\\\"
        case "\n": o += "\\n"
        case "\r": o += "\\r"
        case "\t": o += "\\t"
        default:
            if c.value < 0x20 { o += String(format: "\\u%04x", c.value) } else { o.unicodeScalars.append(c) }
        }
    }
    return o
}

// ---------------------------------------------------------------- walk

struct El {
    let role: String, text: String, path: String
    let x: Double, y: Double, w: Double, h: Double
    let depth: Int, app: String, window: String
}

var out: [El] = []
var seen = 0
let start = Date()
var truncated = false

func overBudget() -> Bool {
    if seen >= MAX_EL { truncated = true; return true }
    if Date().timeIntervalSince(start) * 1000 > BUDGET_MS { truncated = true; return true }
    return false
}

func walk(_ e: AXUIElement, depth: Int, path: String, app: String, window: String) {
    if depth > MAX_DEPTH || overBudget() { return }
    seen += 1
    let role = axStr(e, kAXRoleAttribute as String) ?? "?"
    let here = path.isEmpty ? role : path + ">" + role

    // Prefer the value, then the title, then the description — the same order
    // a screen reader announces them in.
    var text = ""
    for a in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
        if let s = axStr(e, a as String), !s.isEmpty { text = s; break }
    }
    // A single run of text longer than this is a document body, not a label;
    // it would dominate the layout and is rarely what you want to animate.
    if text.count > 240 { text = String(text.prefix(240)) }

    if !text.isEmpty, let r = axRect(e), r.width > 1, r.height > 1 {
        out.append(El(role: role, text: text, path: here,
                      x: Double(r.origin.x), y: Double(r.origin.y),
                      w: Double(r.width), h: Double(r.height),
                      depth: depth, app: app, window: window))
    }
    guard let kids = axCopy(e, kAXChildrenAttribute as String) as? [AXUIElement] else { return }
    for k in kids { walk(k, depth: depth + 1, path: here, app: app, window: window) }
}

// ---------------------------------------------------------------- main

let trusted: Bool = PROMPT
    ? AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    : AXIsProcessTrusted()

if !trusted {
    let msg = "Accessibility permission is not granted. "
            + "Open System Settings > Privacy & Security > Accessibility and add the program running this "
            + "(Terminal, or ax-reader itself), then run it again. Re-run with --prompt to be asked directly."
    print("{\"ok\":false,\"trusted\":false,\"error\":\"\(esc(msg))\",\"elements\":[]}")
    exit(0)
}

var apps: [NSRunningApplication] = []
if WANT_ALL {
    apps = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
} else if let f = NSWorkspace.shared.frontmostApplication {
    apps = [f]
}

for a in apps {
    if overBudget() { break }
    let name = a.localizedName ?? "?"
    let app = AXUIElementCreateApplication(a.processIdentifier)
    guard let wins = axCopy(app, kAXWindowsAttribute as String) as? [AXUIElement] else { continue }
    for w in wins {
        if overBudget() { break }
        let title = axStr(w, kAXTitleAttribute as String) ?? ""
        walk(w, depth: 0, path: name, app: name, window: title)
    }
}

// screen geometry, so the consumer can normalise without guessing
let scr = NSScreen.main?.frame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
var json = "{\"ok\":true,\"trusted\":true,"
json += "\"screen\":{\"w\":\(Int(scr.width)),\"h\":\(Int(scr.height))},"
json += "\"scanned\":\(seen),\"truncated\":\(truncated),"
json += "\"ms\":\(Int(Date().timeIntervalSince(start) * 1000)),"
json += "\"elements\":["
json += out.map { e in
    "{\"role\":\"\(esc(e.role))\",\"text\":\"\(esc(e.text))\",\"path\":\"\(esc(e.path))\","
  + "\"app\":\"\(esc(e.app))\",\"window\":\"\(esc(e.window))\","
  + "\"x\":\(Int(e.x)),\"y\":\(Int(e.y)),\"w\":\(Int(e.w)),\"h\":\(Int(e.h)),\"depth\":\(e.depth)}"
}.joined(separator: ",")
json += "]}"
print(json)
