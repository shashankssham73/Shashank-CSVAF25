// hud-panel.swift — the persistent window.
//
// A borderless NSPanel holding a WKWebView pointed at the visualizer served by
// telemetryd. It stays on screen while you use the machine normally:
//
//   .nonactivatingPanel      clicking it never steals focus from your work
//   .canJoinAllSpaces        follows you when you switch Spaces
//   .fullScreenAuxiliary     survives another app going fullscreen
//   hidesOnDeactivate=false  stays visible when this app is not frontmost
//   level = .statusBar       above ordinary windows
//
// Click-through by default. Control-Option-V makes it interactive: then you can
// drag it anywhere, resize from any edge or corner, nudge it with the arrow
// keys, and use the visualizer's own keyboard controls.
//
// Two things a naive implementation gets wrong, both fixed here:
//   - a WKWebView covering the content view swallows every mouse event, so
//     isMovableByWindowBackground never fires. A transparent handler view sits
//     ABOVE the web view and does move/resize itself. The visualizer is
//     keyboard-only, so nothing is lost by taking the mouse.
//   - a .borderless window returns false from canBecomeKey, so it receives no
//     key events at all. HUDPanel overrides it.
//
// Position and size are remembered across launches.
//
//   swiftc -O -o bin/hud-panel src/hud-panel.swift && ./bin/hud-panel
//
//   --port 7777      daemon port
//   --w 520 --h 330  initial size, if nothing is remembered
//   --alpha 0.55     opacity
//   --corner br      br | bl | tr | tl
//   --full           render the full FUI instead of the compact view
//   --reset          forget the remembered frame

import AppKit
import WebKit
import Carbon.HIToolbox

func arg(_ name: String, _ fallback: String) -> String {
    let a = CommandLine.arguments
    if let i = a.firstIndex(of: "--" + name), i + 1 < a.count { return a[i + 1] }
    return fallback
}
func flag(_ name: String) -> Bool { CommandLine.arguments.contains("--" + name) }

let PORT    = arg("port", "7777")
let PW      = CGFloat(Double(arg("w", "520")) ?? 520)
let PH      = CGFloat(Double(arg("h", "330")) ?? 330)
let ALPHA   = CGFloat(Double(arg("alpha", "0.55")) ?? 0.55)
let CORNER  = arg("corner", "br")
let COMPACT = !flag("full")
let MARGIN: CGFloat = 24
let MIN_W: CGFloat = 260
let MIN_H: CGFloat = 170
let FRAME_KEY = "hud.frame"
let VIEW_KEY  = "hud.view"

// ---------------------------------------------------------------- views
// The panel can host either system. Both pages honour ?compact=1, so the
// same window serves both without knowing anything about either.
struct HUDView { let title: String; let path: String }
let VIEWS = [
    HUDView(title: "Computing Visualizer", path: "/viz.html"),
    HUDView(title: "Psychedelic OS",       path: "/m1/view.html"),
]

// --url wins, then --view by name, then whatever was open last, then the
// visualizer. Remembering the last one matters because this panel is meant
// to be left running for days.
func initialPath() -> String {
    let u = arg("url", "")
    if !u.isEmpty { return u.hasPrefix("/") ? u : "/" + u }
    let name = arg("view", "").lowercased()
    if !name.isEmpty {
        if name.hasPrefix("psy") { return "/m1/view.html" }
        if name.hasPrefix("viz") || name.hasPrefix("comp") { return "/viz.html" }
    }
    if let saved = UserDefaults.standard.string(forKey: VIEW_KEY), !saved.isEmpty { return saved }
    return "/viz.html"
}

// ---------------------------------------------------------------- the panel

final class HUDPanel: NSPanel {
    // Without this a borderless panel never becomes key and receives no
    // keyboard at all — the visualizer's d/f/s/[/] keys would be dead.
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func keyDown(with e: NSEvent) {
        let step: CGFloat = e.modifierFlags.contains(.option) ? 1 : 10
        let shift = e.modifierFlags.contains(.shift)
        var f = frame
        switch Int(e.keyCode) {
        case kVK_LeftArrow:  if shift { f.size.width  = max(MIN_W, f.width - step) } else { f.origin.x -= step }
        case kVK_RightArrow: if shift { f.size.width  = f.width + step }            else { f.origin.x += step }
        case kVK_DownArrow:  if shift { f.size.height = max(MIN_H, f.height - step); f.origin.y += step } else { f.origin.y -= step }
        case kVK_UpArrow:    if shift { f.size.height = f.height + step; f.origin.y -= step } else { f.origin.y += step }
        // Command-Return rather than a bare letter: the page owns every
        // single-key shortcut, and 'f' already means feedback in the visualizer.
        case kVK_Return where e.modifierFlags.contains(.command):
            HUD.shared.toggleZoom(); return
        default: super.keyDown(with: e); return        // everything else to the web view
        }
        setFrame(f, display: true)
        HUD.shared.saveFrame()
    }
}

// ------------------------------------------------- move / resize handler
// Sits above the web view and takes the mouse. Within `edge` points of a
// border it resizes from that edge or corner; anywhere else it moves.

final class GrabView: NSView {
    enum Mode { case move, left, right, top, bottom, tl, tr, bl, br }
    let edge: CGFloat = 12
    private var mode: Mode = .move
    private var startMouse = NSPoint.zero
    private var startFrame = NSRect.zero

    override var acceptsFirstResponder: Bool { false }   // keys stay with the web view
    override func acceptsFirstMouse(for e: NSEvent?) -> Bool { true }
    override var isOpaque: Bool { false }

    private func modeFor(_ p: NSPoint) -> Mode {
        let b = bounds
        let l = p.x < edge, r = p.x > b.width - edge
        let d = p.y < edge, u = p.y > b.height - edge     // view coords: y is up
        if l && u { return .tl }; if r && u { return .tr }
        if l && d { return .bl }; if r && d { return .br }
        if l { return .left }; if r { return .right }
        if u { return .top }; if d { return .bottom }
        return .move
    }

    override func mouseDown(with e: NSEvent) {
        guard let w = window else { return }
        startMouse = NSEvent.mouseLocation
        startFrame = w.frame
        mode = modeFor(convert(e.locationInWindow, from: nil))
    }

    override func mouseDragged(with e: NSEvent) {
        guard let w = window else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - startMouse.x, dy = now.y - startMouse.y
        var f = startFrame

        // Resizing from a left or bottom edge has to move the origin as well,
        // because the opposite edge is the one that must stay put.
        func fromLeft()   { let n = max(MIN_W, startFrame.width  - dx); f.origin.x = startFrame.maxX - n; f.size.width  = n }
        func fromBottom() { let n = max(MIN_H, startFrame.height - dy); f.origin.y = startFrame.maxY - n; f.size.height = n }

        switch mode {
        case .move:   f.origin.x += dx; f.origin.y += dy
        case .right:  f.size.width  = max(MIN_W, startFrame.width  + dx)
        case .top:    f.size.height = max(MIN_H, startFrame.height + dy)
        case .left:   fromLeft()
        case .bottom: fromBottom()
        case .tr:     f.size.width = max(MIN_W, startFrame.width + dx); f.size.height = max(MIN_H, startFrame.height + dy)
        case .tl:     fromLeft();   f.size.height = max(MIN_H, startFrame.height + dy)
        case .br:     f.size.width = max(MIN_W, startFrame.width + dx); fromBottom()
        case .bl:     fromLeft();   fromBottom()
        }
        w.setFrame(f, display: true)
    }

    override func mouseUp(with e: NSEvent) { HUD.shared.saveFrame() }

    override func resetCursorRects() {
        discardCursorRects()
        let b = bounds, e = edge
        addCursorRect(b, cursor: .openHand)
        addCursorRect(NSRect(x: 0, y: 0, width: e, height: b.height), cursor: .resizeLeftRight)
        addCursorRect(NSRect(x: b.width - e, y: 0, width: e, height: b.height), cursor: .resizeLeftRight)
        addCursorRect(NSRect(x: 0, y: 0, width: b.width, height: e), cursor: .resizeUpDown)
        addCursorRect(NSRect(x: 0, y: b.height - e, width: b.width, height: e), cursor: .resizeUpDown)
    }

    // Corner grips, drawn only while interactive so the affordance is visible.
    override func draw(_ r: NSRect) {
        guard HUD.shared.interactive else { return }
        let b = bounds, L: CGFloat = 14, i: CGFloat = 3
        NSColor(calibratedRed: 0.21, green: 0.88, blue: 1.0, alpha: 0.85).setStroke()
        let p = NSBezierPath(); p.lineWidth = 1.5
        for (cx, cy, sx, sy) in [(i, i, 1.0, 1.0), (b.width - i, i, -1.0, 1.0),
                                 (i, b.height - i, 1.0, -1.0), (b.width - i, b.height - i, -1.0, -1.0)] {
            p.move(to: NSPoint(x: cx + L * CGFloat(sx), y: cy))
            p.line(to: NSPoint(x: cx, y: cy))
            p.line(to: NSPoint(x: cx, y: cy + L * CGFloat(sy)))
        }
        p.stroke()
    }
}

// ---------------------------------------------------------------- app

final class HUD: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    static let shared = HUD()

    var panel: HUDPanel!
    var web: WKWebView!
    var grab: GrabView!
    var status: NSStatusItem!
    var interactive = false
    var retry: Timer?
    // Which page the panel is showing. Switchable at runtime from the status
    // menu and remembered across launches, because this window is meant to be
    // left up for days rather than relaunched with a different flag.
    var viewPath = initialPath()

    // The frame to go back to when un-maximising. Nil means "not zoomed".
    var restoreFrame: NSRect?

    // The screen the panel is mostly on, not merely the main one — otherwise
    // maximising on a second display would throw the window to the first.
    func currentScreen() -> NSScreen {
        let f = panel.frame
        var best = NSScreen.main ?? NSScreen.screens[0]
        var bestArea: CGFloat = -1
        for s in NSScreen.screens {
            let i = s.frame.intersection(f)
            let a = i.isNull ? 0 : i.width * i.height
            if a > bestArea { bestArea = a; best = s }
        }
        return best
    }

    // `full` covers the menu bar and Dock too. The panel sits at .statusBar
    // level, so it genuinely covers them — which for a desktop-wide effect is
    // the point, and for everyday use is not.
    func zoomTo(_ kind: String) {
        let s = currentScreen()
        let vis = s.visibleFrame, all = s.frame
        if restoreFrame == nil { restoreFrame = panel.frame }
        var f: NSRect
        switch kind {
        case "full":    f = all
        case "left":    f = NSRect(x: vis.minX, y: vis.minY, width: vis.width / 2, height: vis.height)
        case "right":   f = NSRect(x: vis.midX, y: vis.minY, width: vis.width / 2, height: vis.height)
        case "quarter": f = NSRect(x: vis.maxX - vis.width / 2 - MARGIN, y: vis.minY + MARGIN,
                                   width: vis.width / 2 - MARGIN, height: vis.height / 2 - MARGIN)
        default:        f = vis                                    // "fill"
        }
        panel.setFrame(f, display: true, animate: false)
        saveFrame()
        refreshMenu()
    }

    func unzoom() {
        guard let f = restoreFrame else { return }
        restoreFrame = nil
        panel.setFrame(f, display: true, animate: false)
        saveFrame()
        refreshMenu()
    }

    func toggleZoom() { restoreFrame == nil ? zoomTo("fill") : unzoom() }

    @objc func menuZoom(_ s: NSMenuItem) { zoomTo(s.representedObject as? String ?? "fill") }
    @objc func menuUnzoom() { unzoom() }

    func defaultFrame() -> NSRect {
        let s = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let x = CORNER.hasSuffix("l") ? s.minX + MARGIN : s.maxX - PW - MARGIN
        let y = CORNER.hasPrefix("t") ? s.maxY - PH - MARGIN : s.minY + MARGIN
        return NSRect(x: x, y: y, width: PW, height: PH)
    }

    // A remembered frame is only honoured if it still intersects a screen —
    // otherwise unplugging a display would strand the panel off-canvas.
    func startFrame() -> NSRect {
        if flag("reset") { UserDefaults.standard.removeObject(forKey: FRAME_KEY); return defaultFrame() }
        guard let s = UserDefaults.standard.string(forKey: FRAME_KEY) else { return defaultFrame() }
        let f = NSRectFromString(s)
        guard f.width >= MIN_W, f.height >= MIN_H,
              NSScreen.screens.contains(where: { $0.visibleFrame.intersects(f) }) else { return defaultFrame() }
        return f
    }

    func saveFrame() {
        UserDefaults.standard.set(NSStringFromRect(panel.frame), forKey: FRAME_KEY)
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        NSApp.setActivationPolicy(.accessory)

        panel = HUDPanel(contentRect: startFrame(),
                         styleMask: [.borderless, .nonactivatingPanel, .resizable],
                         backing: .buffered, defer: false)
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.alphaValue = ALPHA
        panel.ignoresMouseEvents = true
        panel.hasShadow = false
        panel.minSize = NSSize(width: MIN_W, height: MIN_H)

        let host = NSView(frame: panel.contentLayoutRect)
        host.wantsLayer = true
        host.layer?.cornerRadius = 10
        host.layer?.masksToBounds = true
        host.layer?.borderWidth = 1
        host.autoresizingMask = [.width, .height]

        web = WKWebView(frame: host.bounds, configuration: WKWebViewConfiguration())
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = .clear }
        host.addSubview(web)

        grab = GrabView(frame: host.bounds)
        grab.autoresizingMask = [.width, .height]
        host.addSubview(grab)                       // above the web view, takes the mouse

        panel.contentView = host
        panel.initialFirstResponder = web
        setBorder()

        // Exclude this window from screen capture. If it works, a full-screen
        // overlay can capture the screen it is covering without recursing.
        // Reported unreliable on macOS 15.4+, so it is attempted, not relied on.
        panel.sharingType = .none

        load()
        panel.orderFrontRegardless()
        buildStatusItem()
        installHotKey()
    }

    func setBorder() {
        panel.contentView?.layer?.borderColor = interactive
            ? NSColor(calibratedRed: 0.21, green: 0.88, blue: 1.0, alpha: 0.95).cgColor
            : NSColor(calibratedRed: 0.13, green: 0.38, blue: 0.48, alpha: 0.55).cgColor
    }

    func load() {
        let q = COMPACT ? "?compact=1" : ""
        guard let u = URL(string: "http://localhost:\(PORT)\(viewPath)\(q)") else { return }
        web.load(URLRequest(url: u))
    }

    @objc func menuView(_ s: NSMenuItem) {
        let i = s.tag
        guard i >= 0 && i < VIEWS.count else { return }
        viewPath = VIEWS[i].path
        UserDefaults.standard.set(viewPath, forKey: VIEW_KEY)
        load()
        refreshMenu()
    }

    // WKWebView refuses getDisplayMedia unless its UI delegate grants it.
    // Without this the page's capture button fails silently, which is exactly
    // what "it does not work in the panel" looks like from the outside.
    @available(macOS 12.0, *)
    func webView(_ w: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // localhost only — this panel loads nothing else.
        decisionHandler(origin.host == "localhost" ? .grant : .deny)
    }

    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { scheduleRetry() }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { scheduleRetry() }
    func scheduleRetry() {
        retry?.invalidate()
        retry = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in self?.load() }
    }

    func toggleInteractive() {
        interactive.toggle()
        panel.ignoresMouseEvents = !interactive
        setBorder()
        grab.needsDisplay = true
        if interactive {
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
            panel.makeFirstResponder(web)
            panel.invalidateCursorRects(for: grab)
        } else {
            panel.resignKey()
        }
        refreshMenu()
    }

    @objc func menuToggle() { toggleInteractive() }
    @objc func menuReload() { load() }
    @objc func menuQuit() { NSApp.terminate(nil) }
    @objc func menuAlpha(_ s: NSMenuItem) { panel.alphaValue = CGFloat(s.tag) / 100.0; refreshMenu() }
    @objc func menuReset() {
        UserDefaults.standard.removeObject(forKey: FRAME_KEY)
        panel.setFrame(defaultFrame(), display: true)
    }

    func buildStatusItem() {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "◉"
        status.button?.toolTip = "Computing Visualizer"
        refreshMenu()
    }

    func refreshMenu() {
        let m = NSMenu()
        let t = NSMenuItem(title: "Interactive  (drag / resize)", action: #selector(menuToggle), keyEquivalent: "")
        t.target = self; t.state = interactive ? .on : .off
        m.addItem(t)
        m.addItem(NSMenuItem(title: "Hotkey:  ⌃⌥V", action: nil, keyEquivalent: ""))
        m.addItem(NSMenuItem(title: "Arrows move · ⇧arrows resize · ⌘↩ maximise", action: nil, keyEquivalent: ""))
        m.addItem(.separator())
        let sub = NSMenu()
        for p in [25, 40, 55, 75, 100] {
            let i = NSMenuItem(title: "\(p)%", action: #selector(menuAlpha(_:)), keyEquivalent: "")
            i.target = self; i.tag = p
            i.state = abs(panel.alphaValue - CGFloat(p) / 100.0) < 0.02 ? .on : .off
            sub.addItem(i)
        }
        let o = NSMenuItem(title: "Opacity", action: nil, keyEquivalent: "")
        m.addItem(o); m.setSubmenu(sub, for: o)
        m.addItem(.separator())
        let vsub = NSMenu()
        for (i, v) in VIEWS.enumerated() {
            let it = NSMenuItem(title: v.title, action: #selector(menuView(_:)), keyEquivalent: "")
            it.target = self; it.tag = i
            it.state = (v.path == viewPath) ? .on : .off
            vsub.addItem(it)
        }
        let vi = NSMenuItem(title: "View", action: nil, keyEquivalent: "")
        m.addItem(vi); m.setSubmenu(vsub, for: vi)

        let zsub = NSMenu()
        for (title, kind) in [("Fill screen", "fill"), ("Cover everything  (over the menu bar)", "full"),
                              ("Left half", "left"), ("Right half", "right"), ("Quarter", "quarter")] {
            let it = NSMenuItem(title: title, action: #selector(menuZoom(_:)), keyEquivalent: "")
            it.target = self; it.representedObject = kind
            zsub.addItem(it)
        }
        zsub.addItem(.separator())
        let un = NSMenuItem(title: "Restore previous size", action: #selector(menuUnzoom), keyEquivalent: "")
        un.target = self; un.isEnabled = restoreFrame != nil
        zsub.addItem(un)
        let zi = NSMenuItem(title: restoreFrame == nil ? "Size" : "Size  (zoomed)",
                            action: nil, keyEquivalent: "")
        m.addItem(zi); m.setSubmenu(zsub, for: zi)

        m.addItem(.separator())
        for (title, sel) in [("Reset position", #selector(menuReset)), ("Reload", #selector(menuReload))] {
            let i = NSMenuItem(title: title, action: sel, keyEquivalent: ""); i.target = self; m.addItem(i)
        }
        let q = NSMenuItem(title: "Quit", action: #selector(menuQuit), keyEquivalent: "q")
        q.target = self; m.addItem(q)
        status.menu = m
    }
}

// ---------------------------------------------------------------- hotkey
// Carbon rather than NSEvent.addGlobalMonitorForEvents: a registered hot key is
// delivered without Accessibility permission, a global monitor is not. This
// project already established that the CGEventTap family silently delivers
// nothing until Accessibility is granted, so this path avoids that entirely.

var hotKeyRef: EventHotKeyRef?

func installHotKey() {
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard),
                             eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(GetApplicationEventTarget(), { _, _, _ -> OSStatus in
        DispatchQueue.main.async { HUD.shared.toggleInteractive() }
        return noErr
    }, 1, &spec, nil, nil)

    let id = EventHotKeyID(signature: OSType(0x43565A31), id: 1)   // 'CVZ1'
    RegisterEventHotKey(UInt32(kVK_ANSI_V), UInt32(controlKey | optionKey),
                        id, GetApplicationEventTarget(), 0, &hotKeyRef)
}

let app = NSApplication.shared
app.delegate = HUD.shared
app.run()
