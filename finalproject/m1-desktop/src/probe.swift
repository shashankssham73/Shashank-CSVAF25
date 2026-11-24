// probe.swift — what will macOS actually let a Psychedelic OS do?
//
// Checks capability and permission WITHOUT prompting, so running it is safe
// and repeatable. Everything the desktop plugin needs rests on three things:
//
//   1. ScreenCaptureKit   can we read the screen at all, and fast enough
//   2. Accessibility      can we read the TEXT and structure of other apps
//   3. Overlay window     can we draw over everything without stealing focus
//
// (3) is already proven — bin/hud-panel does it. This probes 1 and 2.

import Foundation
import AppKit
import CoreGraphics
import ApplicationServices

func line(_ k: String, _ v: String, _ ok: Bool? = nil) {
    let mark = ok == nil ? "     " : (ok! ? " ok  " : " --  ")
    print("\(mark)\(k.padding(toLength: 34, withPad: " ", startingAt: 0)) \(v)")
}

let v = ProcessInfo.processInfo.operatingSystemVersion
print("\n=== SYSTEM ===")
line("macOS", "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)")

// ---------------------------------------------------------------- displays
print("\n=== DISPLAYS ===")
var total = 0
for s in NSScreen.screens {
    let f = s.frame, sc = s.backingScaleFactor
    let px = Int(f.width * sc) * Int(f.height * sc)
    total += px
    line("display", "\(Int(f.width))x\(Int(f.height)) @\(sc)x = \(Int(f.width*sc))x\(Int(f.height*sc)) px")
}
line("pixels to process per frame", "\(total) (\(String(format: "%.1f", Double(total)/1e6)) MP)")
line("at 60 fps", String(format: "%.1f MP/s — GPU territory, not CPU", Double(total)*60/1e6))

// ---------------------------------------------------------------- capture
print("\n=== SCREEN CAPTURE ===")
// CGPreflightScreenCaptureAccess reports without prompting.
let capOK = CGPreflightScreenCaptureAccess()
line("Screen Recording permission", capOK ? "GRANTED" : "not granted (one prompt needed)", capOK)
if #available(macOS 12.3, *) {
    line("ScreenCaptureKit", "available (macOS 12.3+)", true)
    line("  exclude own overlay", "SCContentFilter(display:excludingApplications:)", true)
} else {
    line("ScreenCaptureKit", "UNAVAILABLE — needs macOS 12.3+", false)
}

// ---------------------------------------------------------------- accessibility
print("\n=== ACCESSIBILITY (the text layer) ===")
let axOK = AXIsProcessTrusted()
line("Accessibility permission", axOK ? "GRANTED" : "not granted (one prompt needed)", axOK)

if axOK {
    let front = NSWorkspace.shared.frontmostApplication
    line("frontmost app", front?.localizedName ?? "?")
    if let pid = front?.processIdentifier {
        let app = AXUIElementCreateApplication(pid)
        var win: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &win) == .success,
           let w = win {
            var found = 0, withText = 0
            var roles: [String: Int] = [:]
            func walk(_ e: AXUIElement, _ depth: Int) {
                if found > 4000 || depth > 14 { return }
                found += 1
                var r: CFTypeRef?
                if AXUIElementCopyAttributeValue(e, kAXRoleAttribute as CFString, &r) == .success,
                   let role = r as? String { roles[role, default: 0] += 1 }
                for attr in [kAXValueAttribute, kAXTitleAttribute, kAXDescriptionAttribute] {
                    var t: CFTypeRef?
                    if AXUIElementCopyAttributeValue(e, attr as CFString, &t) == .success,
                       let s = t as? String, !s.isEmpty { withText += 1; break }
                }
                var kids: CFTypeRef?
                if AXUIElementCopyAttributeValue(e, kAXChildrenAttribute as CFString, &kids) == .success,
                   let cs = kids as? [AXUIElement] { for c in cs { walk(c, depth + 1) } }
            }
            let t0 = Date()
            walk(w as! AXUIElement, 0)
            let ms = Date().timeIntervalSince(t0) * 1000
            line("UI elements in focused window", "\(found)", found > 0)
            line("  carrying readable text", "\(withText)", withText > 0)
            line("  tree walk cost", String(format: "%.1f ms", ms), ms < 200)
            let top = roles.sorted { $0.value > $1.value }.prefix(6)
                .map { "\($0.key.replacingOccurrences(of: "AX", with: ""))x\($0.value)" }
            line("  roles seen", top.joined(separator: " "))
        } else {
            line("focused window", "could not read it", false)
        }
    }
} else {
    line("", "grant it and re-run to measure the text layer")
}

print("\n=== VERDICT ===")
print("""
     capture  \(capOK ? "ready" : "needs one permission grant")
     text     \(axOK ? "ready" : "needs one permission grant")
     overlay  already built (bin/hud-panel)
""")
