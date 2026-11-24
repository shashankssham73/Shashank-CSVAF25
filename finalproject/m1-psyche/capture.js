// capture.js — the real screen as a source.
//
// `getDisplayMedia` puts the desktop into a <video> element, which draws into
// a canvas like any other image. No native code: the ScreenCaptureKit bridge
// I expected to need is not required for the pixel path. Confirmed working in
// Safari 18.5 (`/m1/captest.html`).
//
// WHAT THIS CAN AND CANNOT DO
//
//   can     feed the image chain — deflection, chemistry, feedback, colour
//   cannot  feed the typography operators
//
// A captured screen is pixels. It has no glyphs, no words, no lines, so there
// is nothing for a per-glyph modulator to address. Recovering that structure
// means the Accessibility API, which a browser cannot reach. That is the real
// boundary in this project: the browser can process pixels, and only native
// code can process structure.
//
// ON FEEDBACK. Capturing the display you are also showing the result on is a
// hall of mirrors. For most software that is a bug to design around; here it
// is the video feedback loop of objective 1.a, arriving for free. Pick a
// single window in the share dialog to avoid it, or pick the whole screen to
// get it on purpose.

export class ScreenCapture {
  constructor() {
    this.stream = null;
    this.video = null;
    this.active = false;
    this.error = '';
    this.w = 0; this.h = 0;
    this.onchange = null;
  }

  get supported() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
  }

  // Must be called from a user gesture (a click), or the browser refuses.
  async start() {
    this.error = '';
    this.endedAt = 0;
    if (!this.supported) { this.error = 'getDisplayMedia unavailable'; return false; }
    try {
      // selfBrowserSurface:'exclude' keeps this browser's own surface out of
      // the capture, which removes the picture-inside-the-picture where the
      // render is captured and re-processed. Browsers that do not know the
      // option ignore it rather than failing, so it is safe to always ask.
      //
      // It does NOT cover the floating Picture-in-Picture window, which the
      // system owns rather than the page: excluding that needs
      // ScreenCaptureKit's excludingApplications:, i.e. the native engine.
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        // 30 is plenty for this and halves the decode cost. The screen is
        // already the heaviest video source there is; asking for 60 on top of
        // a floating window's own capture is what pushes it over.
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false,
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
      });
    } catch (e) {
      // The user cancelling the picker is not an error worth shouting about.
      this.error = (e && e.name === 'NotAllowedError') ? 'capture cancelled'
                 : 'capture failed: ' + (e && e.message || e);
      return false;
    }

    const v = document.createElement('video');
    v.autoplay = true; v.muted = true; v.playsInline = true;
    // In the document, not detached. A video element that was never in the
    // layout can stop advancing once the page is hidden, which would freeze
    // the floating window on the last frame it saw -- the same failure the
    // Picture in Picture video had.
    v.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;'
                    + 'opacity:0.01;pointer-events:none;z-index:-1';
    document.body.appendChild(v);
    v.srcObject = this.stream;
    try { await v.play(); } catch (_) {}
    this.video = v;

    // Stop cleanly when the user ends sharing from the browser's own banner --
    // or when the browser ends it on its own, which is indistinguishable from
    // the outside unless it is recorded.
    for (const t of this.stream.getVideoTracks()) {
      t.addEventListener('ended', () => {
        this.endedAt = Date.now();
        this.error = 'screen sharing ended — click "capture my screen" to resume';
        const detail = `track ended (state ${t.readyState}, ${Math.round((Date.now() - this.startedAt) / 1000)}s after start)`;
        console.warn('[capture]', detail, t.label);
        if (window.psycheDiag) window.psycheDiag(detail, 'bad');
        this.stop(true);
      });
    }
    this.active = true;
    this.startedAt = Date.now();
    if (this.onchange) this.onchange();
    return true;
  }

  // `keepError` preserves the reason when the browser ended it for us; an
  // explicit stop by the user clears it, because that is not a fault.
  stop(keepError) {
    if (!keepError) this.error = '';
    if (this.video && this.video.parentNode) this.video.remove();
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video = null;
    this.active = false;
    this.w = this.h = 0;
    if (this.onchange) this.onchange();
  }

  // True once there is a decoded frame to draw. A <video> reports zero
  // dimensions for a few frames after play(), and drawing it then throws.
  get ready() {
    const v = this.video;
    return !!(this.active && v && v.readyState >= 2 && v.videoWidth > 0);
  }

  get label() {
    if (!this.active) return this.error || 'not capturing';
    if (!this.ready) return 'starting…';
    return `${this.w}x${this.h}`;
  }

  // Draw the current frame into ctx at w x h, letterboxed so the desktop is
  // never stretched — the raster is 1.6 and a display rarely is.
  draw(ctx, w, h) {
    if (!this.ready) return false;
    const v = this.video;
    this.w = v.videoWidth; this.h = v.videoHeight;
    const s = Math.min(w / this.w, h / this.h);
    const dw = this.w * s, dh = this.h * s;
    ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return true;
  }
}

// --------------------------------------------------------------- native feed
// The whole screen, with the window showing the result left out of it.
//
// Same interface as ScreenCapture above, so the renderer cannot tell them
// apart — but the frames come from the daemon rather than getDisplayMedia.
// Three things follow from that: no share dialog, no picture-inside-picture
// (ScreenCaptureKit excludes our overlay, which the browser API cannot do),
// and no permission needed from the browser at all — it is the daemon's
// helper that holds Screen Recording, not this page.
export class NativeFeed {
  constructor() {
    this.active = false;
    this.error = '';
    this.bmp = null;
    this.w = 0; this.h = 0;
    this.onchange = null;
    this.endedAt = 0;
    this.startedAt = 0;
    this.frames = 0;
    this._gen = 0;
  }

  get supported() { return typeof createImageBitmap === 'function'; }

  async start(opts = {}) {
    if (this.active) return true;
    this.error = ''; this.endedAt = 0; this.frames = 0;
    try {
      const q = new URLSearchParams({
        width: String(opts.width || 1470),
        fps: String(opts.fps || 30),
        quality: String(opts.quality || 0.6),
        // Exclude whatever is showing the result. The overlay is the usual
        // case; add the browser's name when running in an ordinary tab, or
        // the render feeds on itself exactly as before.
        exclude: opts.exclude || 'hud-panel',
      });
      const r = await fetch('/screen/start?' + q, { cache: 'no-store' });
      const j = await r.json();
      if (!j.started && !j.running) {
        this.error = j.error || 'could not start the screen feed';
        return false;
      }
    } catch (e) {
      this.error = 'daemon not reachable: ' + (e.message || e);
      return false;
    }
    this.active = true;
    this.startedAt = Date.now();
    this._pump(++this._gen);
    if (this.onchange) this.onchange();
    return true;
  }

  // One request outstanding at a time. The daemon holds each one open until
  // the next frame lands, so this is paced by the capture, not by a timer.
  async _pump(gen) {
    while (this.active && gen === this._gen) {
      try {
        const r = await fetch('/screen.jpg', { cache: 'no-store' });
        if (!r.ok) {
          let why = 'feed stopped';
          try { why = (await r.json()).error || why; } catch (_) {}
          this.error = why;
          this.endedAt = Date.now();
          this.stop(true);
          return;
        }
        const bmp = await createImageBitmap(await r.blob());
        if (!this.active || gen !== this._gen) { bmp.close && bmp.close(); return; }
        if (this.bmp && this.bmp.close) this.bmp.close();
        this.bmp = bmp;
        this.w = bmp.width; this.h = bmp.height;
        this.frames++;
      } catch (e) {
        if (!this.active) return;
        this.error = String(e.message || e);
        this.endedAt = Date.now();
        this.stop(true);
        return;
      }
    }
  }

  stop(keepError) {
    if (!keepError) this.error = '';
    this.active = false;
    this._gen++;
    if (this.bmp && this.bmp.close) this.bmp.close();
    this.bmp = null;
    this.w = this.h = 0;
    fetch('/screen/stop', { cache: 'no-store' }).catch(() => {});
    if (this.onchange) this.onchange();
  }

  get ready() { return !!(this.active && this.bmp); }

  get label() {
    if (!this.active) return this.error || 'not capturing';
    if (!this.ready) return 'starting…';
    return `${this.w}x${this.h} native`;
  }

  draw(ctx, w, h) {
    if (!this.ready) return false;
    const s = Math.min(w / this.w, h / this.h);
    const dw = this.w * s, dh = this.h * s;
    ctx.drawImage(this.bmp, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return true;
  }
}
