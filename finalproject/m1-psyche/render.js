// render.js — drawing a desktop whose letters are under signal control.
//
// Two passes. The chrome (window frames, folder icons, the menu bar) is plain
// geometry and is drawn normally. The text is drawn one glyph at a time, each
// through its own transform, because that is the only way a wave can travel
// along a word or a single letter can fall off a line.
//
// ON VARIABLE FONTS. Canvas2D cannot set OpenType variation axes: `ctx.font`
// takes a CSS font shorthand and `font-variation-settings` is not part of it.
// So weight, width and slant are SYNTHESISED — weight by stroking the glyph
// outline over the fill, width by scaling, slant by a shear. Continuous and
// cheap, and it reads correctly, but it is not true axis interpolation. The
// honest version renders text through the DOM or a signed-distance-field
// atlas; that is a later problem and it does not change the patch at all.

import { hueRotate, hexToRgb, rgbToHex } from '../m0-telemetry/patch/opkit.js';

export const FONT = 'ui-sans-serif, -apple-system, "SF Pro Text", system-ui, sans-serif';

export const PAL = {
  wall:    '#0a0d14',
  bar:     'rgba(22,28,38,0.92)',
  win:     'rgba(16,21,30,0.95)',
  winEdge: 'rgba(80,110,140,0.55)',
  titleBar:'rgba(28,36,48,0.95)',
  folder:  'rgba(70,140,180,0.30)',
  folderEdge:'rgba(110,190,230,0.70)',
  text:    '#d7e6f0',
  branch:  'rgba(96,150,170,0.80)',
  branchIn:'rgba(150,215,235,0.35)',
  fruit:   'rgba(120,225,255,0.85)',
  fruitHot:'rgba(255,205,120,0.9)',
};

// Canvas text measurement is slow enough to matter at 400+ glyphs a frame and
// the answers never change, so they are cached by character and size.
export function makeMeasurer(ctx) {
  const cache = new Map();
  return (ch, size) => {
    const k = ch + '\u0000' + size;
    let v = cache.get(k);
    if (v === undefined) {
      ctx.font = `${size}px ${FONT}`;
      v = ctx.measureText(ch).width;
      cache.set(k, v);
    }
    return v;
  };
}

export function drawChrome(ctx, chrome, W, H) {
  ctx.save();
  for (const c of chrome) {
    if (c.t === 'bar') {
      ctx.fillStyle = PAL.bar;
      ctx.fillRect(c.x, c.y, c.w, c.h);
    } else if (c.t === 'win') {
      ctx.fillStyle = PAL.win;
      ctx.strokeStyle = PAL.winEdge;
      ctx.lineWidth = 1;
      round(ctx, c.x, c.y, c.w, c.h, 9);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = PAL.titleBar;
      round(ctx, c.x, c.y, c.w, 34, 9, true);
      ctx.fill();
      // the three dots
      ['#e06b5e', '#e0b35e', '#6fbf86'].forEach((col, k) => {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(c.x + 18 + k * 17, c.y + 17, 5.5, 0, Math.PI * 2); ctx.fill();
      });
    } else if (c.t === 'branch') {
      // A tapered quad rather than a stroked line: thickness has to vary
      // along a branch, because the strand model is the whole point.
      const dx = c.x2 - c.x1, dy = c.y2 - c.y1;
      const l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      const a = c.w1 / 2, b = c.w2 / 2;
      ctx.beginPath();
      ctx.moveTo(c.x1 + nx * a, c.y1 + ny * a);
      ctx.lineTo(c.x2 + nx * b, c.y2 + ny * b);
      ctx.lineTo(c.x2 - nx * b, c.y2 - ny * b);
      ctx.lineTo(c.x1 - nx * a, c.y1 - ny * a);
      ctx.closePath();
      ctx.fillStyle = PAL.branch;
      ctx.fill();
      // a lit edge, so deep branches still read against the trunk
      ctx.strokeStyle = PAL.branchIn;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    } else if (c.t === 'fruit') {
      const n = Math.round(c.petals);
      if (n >= 3 && c.bloom > 0.01) {
        // a flower: petals as ellipses around the centre
        ctx.fillStyle = PAL.fruit;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + (c.a || 0);
          ctx.save();
          ctx.translate(c.x + Math.cos(a) * c.r * c.bloom,
                        c.y + Math.sin(a) * c.r * c.bloom);
          ctx.rotate(a);
          ctx.beginPath();
          ctx.ellipse(0, 0, c.r * 0.92, c.r * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = PAL.fruitHot;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.42, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = PAL.fruit;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
      }
    } else if (c.t === 'folder') {
      ctx.fillStyle = PAL.folder;
      ctx.strokeStyle = PAL.folderEdge;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y + 8);
      ctx.lineTo(c.x + c.w * 0.42, c.y + 8);
      ctx.lineTo(c.x + c.w * 0.52, c.y);
      ctx.lineTo(c.x + c.w, c.y);
      ctx.lineTo(c.x + c.w, c.y + c.h);
      ctx.lineTo(c.x, c.y + c.h);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

function round(ctx, x, y, w, h, r, topOnly) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  if (topOnly) { ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); }
  else {
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  }
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Colour cache: hue rotation is trig per glyph otherwise, and a frame's worth
// of glyphs mostly lands on the same handful of hues.
const hueCache = new Map();
function tint(base, turns) {
  if (!turns) return base;
  const q = Math.round(turns * 720) / 720;
  const k = base + '|' + q;
  let v = hueCache.get(k);
  if (v === undefined) {
    v = rgbToHex(hueRotate(hexToRgb(base), q));
    if (hueCache.size > 4000) hueCache.clear();
    hueCache.set(k, v);
  }
  return v;
}

// glyphs: from scene.layout(). xf(g) -> the transform for that glyph.
export function drawGlyphs(ctx, glyphs, xf, baseColour = PAL.text) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const g of glyphs) {
    const o = xf(g);
    if (o.alpha <= 0.003) continue;
    const col = tint(o.colour || baseColour, o.hue);

    ctx.save();
    ctx.translate(g.x + o.dx, g.y + o.dy);
    if (o.rot) ctx.rotate(o.rot);
    // shear for slant; negative so a positive slant leans right like italic
    if (o.slant) ctx.transform(1, 0, -Math.tan(o.slant), 1, 0, 0);
    if (o.sx !== 1 || o.sy !== 1) ctx.scale(o.sx, o.sy);

    // ctx.save()/restore() resets the font, so it is set per glyph. Caching
    // it across the loop would be wrong, not just useless.
    ctx.font = `${g.size}px ${FONT}`;
    ctx.globalAlpha = o.alpha;
    ctx.fillStyle = col;
    ctx.fillText(g.ch, 0, 0);
    // synthetic weight: stroke the outline on top of the fill
    if (o.weight > 0.01) {
      ctx.lineWidth = o.weight;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = col;
      ctx.strokeText(g.ch, 0, 0);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------- surfaces
//
// Draws the desktop surface by surface, each inside its own transform. That
// is what makes a rotated window carry its title and its paragraphs: the
// glyphs are drawn in the surface's transformed space, and the typography
// stack then runs inside that.
//
// The menu bar is drawn last so it stays on top, the way it does on a real
// desktop — even when it has been rotated off into a corner.

export function drawScene(ctx, scene, glyphs, surfXf, glyphXf, baseColour = PAL.text) {
  const W = scene.W, H = scene.H;
  const chromeBy = new Map(), glyphBy = new Map();
  for (const c of scene.chrome) {
    let a = chromeBy.get(c.surf); if (!a) chromeBy.set(c.surf, a = []);
    a.push(c);
  }
  for (const g of glyphs) {
    let a = glyphBy.get(g.surf); if (!a) glyphBy.set(g.surf, a = []);
    a.push(g);
  }

  const order = scene.surfaces.filter(s => s.kind !== 'bar')
          .concat(scene.surfaces.filter(s => s.kind === 'bar'));

  for (const s of order) {
    const o = surfXf ? surfXf(s) : null;
    ctx.save();
    if (o) {
      ctx.translate(s.cx + o.dx, s.cy + o.dy);
      if (o.rot) ctx.rotate(o.rot);
      if (o.kx || o.ky) ctx.transform(1, o.ky, o.kx, 1, 0, 0);
      if (o.sx !== 1 || o.sy !== 1) ctx.scale(o.sx, o.sy);
      ctx.translate(-s.cx, -s.cy);
    }
    const ch = chromeBy.get(s.id);
    if (ch) drawChrome(ctx, ch, W, H);
    const gl = glyphBy.get(s.id);
    if (gl) drawGlyphs(ctx, gl, glyphXf, baseColour);
    ctx.restore();
  }
}
