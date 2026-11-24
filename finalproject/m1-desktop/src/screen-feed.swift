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

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .screen, sb.isValid,
              let px = CMSampleBufferGetImageBuffer(sb) else { return }
        let img = CIImage(cvImageBuffer: px)
        guard let jpeg = ci.jpegRepresentation(of: img, colorSpace: space,
                  options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: argQ])
        else { return }
        emit(jpeg)

        frames += 1
        if Date().timeIntervalSince(lastReport) > 5 {
            log("\(frames) frames in 5s (\(frames / 5)/s), \(jpeg.count / 1024)KB/frame")
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

Task {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: true)
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

        let filter = SCContentFilter(display: display,
                                     excludingApplications: excluded,
                                     exceptingWindows: [])

        let cfg = SCStreamConfiguration()
        let scale = Double(argW) / Double(display.width)
        cfg.width  = argW
        cfg.height = Int((Double(display.height) * scale).rounded())
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(argFPS))
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        cfg.queueDepth = 3
        cfg.showsCursor = true
        cfg.capturesAudio = false

        log("display \(display.width)x\(display.height) -> \(cfg.width)x\(cfg.height) @\(argFPS)fps q\(argQ)")

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
