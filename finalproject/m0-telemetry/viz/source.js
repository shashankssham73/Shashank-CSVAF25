// The source layer — what the video synthesiser is pointed at.
//
// In a real Rutt/Etra chain this is the camera: a low-bandwidth raster whose
// luminance becomes vertical deflection and whose chroma becomes the key. So
// everything here is drawn for its SIGNAL value, not to be looked at directly.
// Resolution is deliberately low; video synthesisers were never sharp, and the
// scan processor only samples it anyway.
//
// Two channels are carried:
//   luminance  -> deflection amplitude        (how high the terrain rises)
//   r vs b     -> key, cyan path or amber fault (which colour it comes out)

import { NODES, BUSES, HERO_ROUTE } from './topology.js';
import { busGeom, pointOn } from './particles.js';

export const SW = 512, SH = 320;        // source raster, fixed and small

// Exported because viz/shapes.js writes into the same raster and has to encode
// luminance and chroma the same way, or a shape would key differently from a
// bus carrying the same brightness.
export const CYAN  = [20, 200, 255];
export const AMBER = [255, 150, 30];
const HERO  = [230, 250, 255];

export class SourceLayer {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.width = SW; this.cv.height = SH;
    this.ctx = this.cv.getContext('2d', { willReadFrequently: true });
    this.geoms = new Map();
    this.rebuild();
  }

  rebuild() {
    this.geoms = new Map();
    for (const b of BUSES) {
      const g = busGeom(b, SW, SH);
      let nx = -(g.ey - g.sy), ny = (g.ex - g.sx);
      const l = Math.hypot(nx, ny) || 1;
      g.nx = nx / l; g.ny = ny / l;
      this.geoms.set(b.id, g);
    }
  }

  draw(parts, sm, chromeFn) {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, SW, SH);
    c.globalCompositeOperation = 'lighter';

    // --- the machine as standing terrain ---------------------------------
    // Nodes and buses are drawn dim. They are permanent features of the
    // landscape; traffic is what makes them rise.
    for (const b of BUSES) {
      const g = this.geoms.get(b.id);
      const lvl = b.dead ? 0 : (sm['lvl.' + b.id] || 0);
      c.beginPath();
      c.moveTo(g.sx, g.sy);
      c.quadraticCurveTo(g.cx, g.cy, g.ex, g.ey);
      c.strokeStyle = `rgba(${CYAN[0]},${CYAN[1]},${CYAN[2]},${0.05 + lvl * 0.30})`;
      c.lineWidth = 1 + lvl * 3.5;
      c.stroke();
    }

    for (const [key, n] of Object.entries(NODES)) {
      const x = n.x * SW, y = n.y * SH, r = n.r * Math.min(SW, SH);
      const hot = key === 'cpu' ? (sm['cpu.busy_pct'] || 0) / 100 : (sm['node.' + key] || 0);
      if (n.dead) {                                   // unmeasurable: a pit, not a peak
        c.strokeStyle = 'rgba(14,26,34,0.9)';
        c.lineWidth = 1;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
        continue;
      }
      const grd = c.createRadialGradient(x, y, 0, x, y, r * 1.5);
      grd.addColorStop(0, `rgba(${CYAN[0]},${CYAN[1]},${CYAN[2]},${0.10 + hot * 0.55})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.beginPath(); c.arc(x, y, r * 1.5, 0, Math.PI * 2); c.fill();
      c.strokeStyle = `rgba(${CYAN[0]},${CYAN[1]},${CYAN[2]},${0.25 + hot * 0.6})`;
      c.lineWidth = 1.2;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
    }

    // --- traffic ----------------------------------------------------------
    for (const p of parts.flow) {
      const g = this.geoms.get(p.bus); if (!g) continue;
      const a = pointOn(g, p.t);
      const x = a.x + g.nx * p.off * 0.35, y = a.y + g.ny * p.off * 0.35;
      const col = p.warn ? AMBER : CYAN;
      const s = p.size * 0.9;
      c.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.50)`;
      c.fillRect(x - s, y - s, s * 2, s * 2);
    }

    for (const h of parts.heroes) {
      const from = HERO_ROUTE[h.leg], to = HERO_ROUTE[h.leg + 1];
      const b = parts.legBus(from, to); if (!b) continue;
      const g = this.geoms.get(b.id); if (!g) continue;
      const fwd = b.from === from;
      const a = pointOn(g, fwd ? h.t : 1 - h.t);
      const s = 2.2 * (1 + h.pulse * 1.5);
      h._sx = a.x / SW; h._sy = a.y / SH;             // normalised, for labelling
      const grd = c.createRadialGradient(a.x, a.y, 0, a.x, a.y, s * 5);
      grd.addColorStop(0, `rgba(${HERO[0]},${HERO[1]},${HERO[2]},0.95)`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = grd;
      c.beginPath(); c.arc(a.x, a.y, s * 5, 0, Math.PI * 2); c.fill();
    }

    // --- chrome that goes through the chain -------------------------------
    // Structural FUI only: frames, ticks, bars. These deform with everything
    // else because they are part of the signal, not an overlay on it.
    if (chromeFn) chromeFn(c, SW, SH);

    c.globalCompositeOperation = 'source-over';
    return this.ctx.getImageData(0, 0, SW, SH);
  }
}
