// The feedback field.
//
// Two offscreen canvases, ping-ponged. Each frame the previous frame is drawn
// back into the current one through a small affine warp (zoom + rotation about
// a centre) at a gain below 1, and the new particles are drawn on top of that.
// That is the whole of video feedback: an iterated map, exactly the system
// Crutchfield parameterises. Bilinear sampling during the warp supplies the
// diffusion term, so a separate blur is not needed at these rates.
//
// Only particles go through this. The machine map is drawn crisp on top of the
// result, so the structure stays readable while the traffic smears.

export class Feedback {
  constructor() {
    this.a = document.createElement('canvas');
    this.b = document.createElement('canvas');
    this.actx = this.a.getContext('2d');
    this.bctx = this.b.getContext('2d');
    this.enabled = true;

    // Parameter ranges from the earlier reading: anything faster than this
    // stops reading as drift and starts reading as a transition.
    this.gain   = 0.945;   // 0.90 bare .. 0.99 long persistence
    this.zoom   = 1.0028;  // per frame
    this.rot    = 0.0009;  // radians per frame
    this.cx     = 0.5;     // warp centre, normalised
    this.cy     = 0.52;
  }

  resize(w, h) {
    for (const c of [this.a, this.b]) { c.width = w; c.height = h; }
    this.actx.clearRect(0, 0, w, h);
    this.bctx.clearRect(0, 0, w, h);
  }

  // Returns the context to draw this frame's particles into.
  begin() {
    const { a, b, bctx } = this;
    const w = a.width, h = a.height;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, w, h);

    if (this.enabled) {
      const cx = this.cx * w, cy = this.cy * h;
      bctx.save();
      bctx.globalAlpha = this.gain;
      bctx.translate(cx, cy);
      bctx.rotate(this.rot);
      bctx.scale(this.zoom, this.zoom);
      bctx.translate(-cx, -cy);
      bctx.drawImage(a, 0, 0);
      bctx.restore();
    }

    bctx.globalCompositeOperation = 'lighter';   // particles add light
    return bctx;
  }

  // Finish the frame and blit the field onto the visible canvas.
  end(dst) {
    this.bctx.globalCompositeOperation = 'source-over';
    dst.drawImage(this.b, 0, 0);
    const t = this.a; this.a = this.b; this.b = t;             // ping-pong
    const tc = this.actx; this.actx = this.bctx; this.bctx = tc;
  }

  clear() {
    this.actx.clearRect(0, 0, this.a.width, this.a.height);
    this.bctx.clearRect(0, 0, this.b.width, this.b.height);
  }
}
