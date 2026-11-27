// screen-feed.swift — the real screen, minus our own overlay.
//
// This is the piece that lets PSYCHE mode affect the whole desktop rather
// than a copy of it in a window.
//
// The browser's own getDisplayMedia captures EVERYTHING, including the window
// showing the processed result, so the effect photographs itself and you get
// a picture inside a picture. ScreenCaptureKit can exclude named applications
// from the capture; the browser API cannot. That single capability is the
// whole reason this program exists.
//
// It does no image processing. Frames go out as JPEG on stdout and the
// existing renderer — every operator, every preset, already written and
// tested — does the work. Writing the effects again in Metal would have been
// a second implementation to keep in step with the first.
//
// Framing on stdout: 4-byte big-endian length, then that many JPEG bytes.
//
//   screen-feed --width 1470 --fps 30 --quality 0.6 --exclude hud-panel
//
import Foundation
import ScreenCaptureKit
import CoreImage
import CoreMedia
import AppKit

// ----------------------------------------------------------------- arguments
var argW = 1470, argFPS = 30
var argQ = 0.6
var excludeNames: [String] = []
// A single window, captured independently of whatever is stacked on top of
// it. That is the difference between this and cropping the screen: an
// occluded window still has content, and ScreenCaptureKit will give it to
// us. Cropping would hand back whatever is covering it.
var argWindow: UInt32 = 0
var listOnly = false
do {
    var i = 1
    let a = CommandLine.arguments
    while i < a.count {
        let k = a[i]
        let v = i + 1 < a.count ? a[i + 1] : ""
        switch k {
        case "--width":   argW = Int(v) ?? argW;        i += 2
        case "--fps":     argFPS = Int(v) ?? argFPS;    i += 2
        case "--quality": argQ = Double(v) ?? argQ;     i += 2
        case "--exclude": if !v.isEmpty { excludeNames.append(v) }; i += 2
        case "--window":  argWindow = UInt32(v) ?? 0; i += 2
        case "--list":    listOnly = true; i += 1
        default: i += 1
        }
    }
}
// Never capture ourselves, whatever else was asked for.
excludeNames.append("screen-feed")

func log(_ s: String) { FileHandle.standardError.write(("screen-feed: " + s + "\n").data(using: .utf8)!) }

// --------------------------------------------------------------- frame output
// stdout is a pipe to the daemon. Writes are serialised on one queue so a
// frame can never be interleaved with another.
let outQueue = DispatchQueue(label: "feed.out")
let stdoutHandle = FileHandle.standardOutput

func emit(_ jpeg: Data) {
    outQueue.async {
        var n = UInt32(jpeg.count).bigEndian
        var packet = Data(bytes: &n, count: 4)
        packet.append(jpeg)
        do { try stdoutHandle.write(contentsOf: packet) }
        catch { exit(0) }            // daemon went away; so do we
    }
}

// ------------------------------------------------------------------- capture
final class Output: NSObject, SCStreamOutput, SCStreamDelegate {
    let ci = CIContext(options: [.useSoftwareRenderer: false])
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    var frames = 0
    var lastReport = Date()

    var got = 0, dropped = 0, lastStatus = -1
    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .screen else { return }
        got += 1
        // Every buffer carries a status. A window that has not redrawn sends
        // `idle` or `blank` buffers with no image attached, which for an
        // occluded window is most of them — so "no frames" needs telling
        // apart from "no buffers".
        var status = -1
        if let arr = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false)
            as? [[SCStreamFrameInfo: Any]], let first = arr.first,
           let raw = first[.status] as? Int { status = raw }
        // 3 is `suspended`: macOS stops rendering a window that is fully
        // covered, so there is genuinely nothing to capture until it is
        // visible again. Not an error and not fatal — the stream resumes on
        // its own, and until then the last frame stands.
        if status == 3 || status == 1 || status == 2 {
            dropped += 1
            if status != lastStatus {
                log(status == 3 ? "SUSPENDED — the window is hidden; holding the last frame"
                  : "idle — nothing has changed")
                lastStatus = status
            }
            return
        }
        if lastStatus == 3 { log("resumed"); }
        lastStatus = status
        guard sb.isValid, let px = CMSampleBufferGetImageBuffer(sb) else {
            dropped += 1
            return
        }
        let img = CIImage(cvImageBuffer: px)
        guard let jpeg = ci.jpegRepresentation(of: img, colorSpace: space,
                  options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: argQ])
        else { return }
        emit(jpeg)

        frames += 1
        if Date().timeIntervalSince(lastReport) > 5 {
            log("\(frames) frames in 5s (\(frames / 5)/s), \(jpeg.count / 1024)KB/frame, "
              + "\(got) buffers \(dropped) empty")
            got = 0; dropped = 0
            frames = 0; lastReport = Date()
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        log("stopped: \(error.localizedDescription)")
        exit(1)
    }
}

let output = Output()
var stream: SCStream?

func jsonString(_ s: String) -> String {
    var o = ""
    for c in s.unicodeScalars {
        switch c {
        case "\"": o += "\\\""
        case "\\": o += "\\\\"
        case "\n": o += "\\n"
        case "\r": o += "\\r"
        case "\t": o += "\\t"
        default:
            if c.value < 0x20 { o += String(format: "\\u%04x", c.value) }
            else { o.unicodeScalars.append(c) }
        }
    }
    return "\"" + o + "\""
}

Task {
    do {
        // onScreenWindowsOnly is false throughout. A window you want to drop
        // into a cut is very often one that is currently buried — and it has
        // to be in this list both to be offered AND to be captured, so
        // asking only for visible ones made occluded windows unlistable and
        // then, worse, uncapturable.
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: false)

        // --list: what is on screen, as JSON, then exit. Windows too small to
        // be worth showing and ones with no owner are dropped; the rest come
        // back largest first, because that is the order you want to pick from.
        if listOnly {
            // Wallpaper, the Dock and the menu bar are windows too, and
            // nobody wants them in a collage.
            let skip = ["Dock", "Wallpaper", "WindowServer", "Window Server",
                        "Control Center", "Notification Center", "Spotlight"]
            let ws = content.windows
                .filter { $0.frame.width > 120 && $0.frame.height > 80 }
                .filter { ($0.owningApplication?.applicationName ?? "").isEmpty == false }
                .filter { !skip.contains($0.owningApplication?.applicationName ?? "") }
                .sorted { $0.frame.width * $0.frame.height > $1.frame.width * $1.frame.height }
            var rows: [String] = []
            for w in ws.prefix(80) {
                let app = w.owningApplication?.applicationName ?? ""
                rows.append("{\"id\":\(w.windowID),"
                    + "\"app\":\(jsonString(app)),"
                    + "\"title\":\(jsonString(w.title ?? "")),"
                    + "\"x\":\(Int(w.frame.minX)),\"y\":\(Int(w.frame.minY)),"
                    + "\"w\":\(Int(w.frame.width)),\"h\":\(Int(w.frame.height)),"
                    + "\"onScreen\":\(w.isOnScreen)}")
            }
            print("{\"windows\":[" + rows.joined(separator: ",") + "]}")
            exit(0)
        }
        guard let display = content.displays.first else {
            log("no display"); exit(1)
        }

        // The point of the whole program: drop our own overlay out of the
        // capture, so the effect does not photograph itself.
        let excluded = content.applications.filter { app in
            excludeNames.contains { name in
                app.applicationName.localizedCaseInsensitiveContains(name)
                || app.bundleIdentifier.localizedCaseInsensitiveContains(name)
            }
        }
        if !excluded.isEmpty {
            log("excluding " + excluded.map { $0.applicationName }.joined(separator: ", "))
        } else if !excludeNames.isEmpty {
            log("nothing matched " + excludeNames.joined(separator: ", ") + " — capturing everything")
        }

        var filter: SCContentFilter
        var srcW = Double(display.width), srcH = Double(display.height)
        if argWindow != 0 {
            guard let win = content.windows.first(where: { $0.windowID == argWindow }) else {
                log("no window with id \(argWindow)"); exit(2)
            }
            // desktopIndependentWindow: the window's own content, whatever is
            // stacked over it.
            filter = SCContentFilter(desktopIndependentWindow: win)
            srcW = Double(win.frame.width); srcH = Double(win.frame.height)
            log("window \(argWindow): \(win.owningApplication?.applicationName ?? "?") — \(win.title ?? "")")
        } else {
            filter = SCContentFilter(display: display,
                                     excludingApplications: excluded,
                                     exceptingWindows: [])
        }

        let cfg = SCStreamConfiguration()
        let scale = Double(argW) / srcW
        cfg.width  = argW
        cfg.height = max(2, Int((srcH * scale).rounded()))
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(argFPS))
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        cfg.queueDepth = 3
        cfg.showsCursor = true
        cfg.capturesAudio = false

        log("source \(Int(srcW))x\(Int(srcH)) -> \(cfg.width)x\(cfg.height) @\(argFPS)fps q\(argQ)")

        let s = SCStream(filter: filter, configuration: cfg, delegate: output)
        try s.addStreamOutput(output, type: .screen,
                              sampleHandlerQueue: DispatchQueue(label: "feed.capture"))
        try await s.startCapture()
        stream = s
        log("running")
    } catch {
        log("FAILED: \(error.localizedDescription)")
        log("Screen Recording permission is granted in System Settings > Privacy & Security.")
        exit(1)
    }
}

RunLoop.main.run()
