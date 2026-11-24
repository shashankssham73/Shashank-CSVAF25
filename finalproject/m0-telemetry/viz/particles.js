// The travellers.
//
// Two populations, deliberately:
//
//   flow   anonymous, cheap, many. Emission rate is the measured channel rate,
//          so density on a bus IS the throughput. Nothing individual to follow.
//   hero   a real named thing — the file FSEvents just reported, the process
//          currently topping the CPU, the host moving the most bytes. Large,
//          labelled, and followed across a multi-leg route through the machine.
//
// The flow carries the scale of what is happening. The heroes carry the story.

import { NODES, BUSES, HERO_ROUTE, norm } from './topology.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- geometry

// Buses are quadratic beziers bowed off the straight line, so the eight that
// meet at the CPU arrive on distinct paths instead of collapsing into a star.
export function busGeom(bus, W, H) {
  const A = NODES[bus.from], B = NODES[bus.to];
  const ax = A.x * W, ay = A.y * H, bx = B.x * W, by = B.y * H;
  let dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;

  // trim to the node rims so particles emerge from the edge, not the centre
  const ra = A.r * Math.min(W, H) * 1.02, rb = B.r * Math.min(W, H) * 1.02;
  const sx = ax + dx * ra, sy = ay + dy * ra;
  const ex = bx - dx * rb, ey = by - dy * rb;

  const mx = (sx + ex) / 2, my = (sy + ey) / 2;
  const cx = mx - dy * bus.bow * len, cy = my + dx * bus.bow * len;
  return { sx, sy, ex, ey, cx, cy, len };
}

export function pointOn(g, t) {
  const u = 1 - t;
  return {
    x: u * u * g.sx + 2 * u * t * g.cx + t * t * g.ex,
    y: u * u * g.sy + 2 * u * t * g.cy + t * t * g.ey,
  };
}

// ---------------------------------------------------------------- system

export class Particles {
  constructor(max = 9000) {
    this.max = max;
    this.flow = [];
    this.heroes = [];
    this.debt = new Map();        // fractional emission carried between frames
    this.speedMul = 1;            // global multiplier, driven by the patch graph
    this.arrived = 0;             // heroes that completed the whole route
    this.lost = 0;                // heroes dropped under pressure
  }

  get count() { return this.flow.length + this.heroes.length; }

  // n particles per second on this bus, from the normalised channel value.
  emitFlow(bus, level, dt, warnLevel) {
    const rate = level * 150;                       // particles/sec at full bus
    const key = bus.id;
    let want = (this.debt.get(key) || 0) + rate * dt;
    const n = Math.floor(want);
    this.debt.set(key, want - n);

    for (let i = 0; i < n && this.flow.length < this.max; i++) {
      this.flow.push({
        bus: bus.id,
        t: 0,
        // speed scales with load: a busy bus moves faster, not just denser
        v: (0.28 + level * 0.55) * (0.75 + Math.random() * 0.5),
        off: (Math.random() - 0.5) * 9,             // lateral scatter off the spline
        size: 0.7 + Math.random() * 1.1,
        warn: Math.random() < warnLevel,
        life: 1,
      });
    }
  }

  spawnHero(label, kind) {
    if (this.heroes.length > 24) return;
    this.heroes.push({
      label: String(label || '?').slice(-34),
      kind,
      leg: 0,
      t: 0,
      v: 0.42 + Math.random() * 0.12,
      size: 2.6,
      born: performance.now(),
      pulse: 0,
      doomed: false,
    });
  }

  // Heroes walk HERO_ROUTE leg by leg. Each leg is matched to whichever bus
  // joins those two nodes, in either direction, so the route follows real wiring.
  legBus(from, to) {
    return BUSES.find(b => (b.from === from && b.to === to)) ||
           BUSES.find(b => (b.from === to && b.to === from));
  }

  // deathProb comes from the patch graph (hero.deathProb), so the one invented
  // rule in the system is now a knob rather than a constant buried in code.
  step(dt, deathProb = 0) {
    const m = this.speedMul;
    // flow
    for (let i = this.flow.length - 1; i >= 0; i--) {
      const p = this.flow[i];
      p.t += p.v * dt * m;
      if (p.t >= 1) this.flow.splice(i, 1);
    }
    // heroes
    for (let i = this.heroes.length - 1; i >= 0; i--) {
      const h = this.heroes[i];
      h.t += h.v * dt * m;
      h.pulse = Math.max(0, h.pulse - dt * 2.5);
      if (h.t >= 1) {
        h.t = 0;
        h.leg++;
        h.pulse = 1;                                  // flash on arriving at a node
        // Under real memory pressure some travellers do not make it. This is
        // the only place the visualizer invents an event, and it is gated on a
        // measured channel rather than on a timer.
        if (deathProb > 0 && Math.random() < deathProb) { this.lost++; this.heroes.splice(i, 1); continue; }
        if (h.leg >= HERO_ROUTE.length - 1) { this.arrived++; this.heroes.splice(i, 1); }
      }
    }
  }

  clear() { this.flow.length = 0; this.heroes.length = 0; }
}
