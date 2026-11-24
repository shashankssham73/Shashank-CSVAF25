// core.js — graph model for the Scanimate-style lab. No DOM. Works in browser and node.
// Rules (same spirit as your patcher):
//  - every signal lives in 0..1; each numeric parameter maps 0..1 to its own min..max
//  - nodes are evaluated in dependency order; a cycle reads the value from the previous frame
(function (g) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // ---------- tiny seeded random + mock telemetry ----------
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  const CHANNELS = ['cpu.busy_pct', 'vm.faults_per_s', 'net.in_bytes_per_s', 'disk.tps', 'batt.watts'];
  const Tele = {
    r: rng(7), v: {}, tgt: {}, t0: {},
    set(name, v) { this.v[name] = clamp(v, 0, 1); }, // call this to feed real daemon values
    step(dt, t) {
      const r = this.r;
      for (const c of CHANNELS) if (this.v[c] === undefined) { this.v[c] = 0.1; this.tgt[c] = 0.1; this.t0[c] = 0; }
      // cpu: target jumps every 1-4 s, value follows
      if (t > this.t0['cpu.busy_pct']) { this.t0['cpu.busy_pct'] = t + 1 + 3 * r(); this.tgt['cpu.busy_pct'] = 0.08 + 0.8 * r() * r(); }
      this.v['cpu.busy_pct'] += (this.tgt['cpu.busy_pct'] - this.v['cpu.busy_pct']) * Math.min(1, dt * 6) + (r() - 0.5) * 0.03;
      // faults, disk: quiet with decaying bursts
      for (const c of ['vm.faults_per_s', 'disk.tps']) {
        if (r() < dt * 0.6) this.tgt[c] = 0.4 + 0.6 * r();
        this.tgt[c] *= Math.exp(-dt * 2.2);
        this.v[c] = 0.04 + this.tgt[c] * (0.8 + 0.2 * r());
      }
      // net: transfer episodes
      if (t > this.t0['net.in_bytes_per_s']) { this.t0['net.in_bytes_per_s'] = t + 2 + 5 * r(); this.tgt['net.in_bytes_per_s'] = r() < 0.5 ? 0.02 : 0.3 + 0.6 * r(); }
      this.v['net.in_bytes_per_s'] += (this.tgt['net.in_bytes_per_s'] - this.v['net.in_bytes_per_s']) * Math.min(1, dt * 3);
      // battery power: slow drift
      this.v['batt.watts'] = 0.35 + 0.15 * Math.sin(t * 0.13) + 0.05 * Math.sin(t * 0.9);
      for (const c of CHANNELS) this.v[c] = clamp(this.v[c], 0, 1);
    },
  };

  // ---------- palettes ----------
  const PRESETS = {
    Tron: ['#000814', '#003566', '#00b4d8', '#90e0ef', '#ffffff'],
    Sunset: ['#0b0020', '#5a0f6b', '#d62e79', '#ff8a3d', '#fff1c1'],
    Phosphor: ['#000500', '#003b00', '#00a800', '#7dff7d', '#e8ffe8'],
    Acid: ['#000000', '#3a0ca3', '#f72585', '#4cc9f0', '#caffbf'],
    Ink: ['#05040a', '#2b2d42', '#8d99ae', '#edf2f4', '#ffffff'],
  };
  const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // LUT: 256 entries -> packed ABGR (little endian Uint32 for ImageData)
  function makeLUT(colors, shift, steps, gamma) {
    const lut = new Uint32Array(256), rgb = colors.map(hex2rgb), n = rgb.length - 1;
    for (let i = 0; i < 256; i++) {
      let t = i / 255;
      t = Math.pow(t, gamma);
      if (steps >= 2) t = Math.min(steps - 1, Math.floor(t * steps)) / (steps - 1);
      t += shift; if (t > 1) t -= Math.floor(t - 1e-12); // shift wraps around, but 1.0 stays 1.0 when shift is 0
      // brightness 0 should stay the first colour even with shift: only shift the non-zero part
      if (i === 0 && shift > 0) t = 0;
      const f = t * n, k = Math.min(n - 1, Math.floor(f)), fr = f - k;
      const a = rgb[k], b = rgb[k + 1];
      const r = a[0] + (b[0] - a[0]) * fr, gg = a[1] + (b[1] - a[1]) * fr, bl = a[2] + (b[2] - a[2]) * fr;
      lut[i] = (255 << 24) | (Math.round(bl) << 16) | (Math.round(gg) << 8) | Math.round(r);
    }
    return lut;
  }

  // ---------- shapes ----------
  // shape = { paths: [ { p:[x0,y0,x1,y1,...], closed:bool } ] } in unit space (-1..1)
  const path = (p, closed) => ({ p, closed });
  const shape = (paths) => ({ paths });
  function polyPts(n, r, rot = 0) { const p = []; for (let i = 0; i < n; i++) { const a = rot + (TAU * i) / n; p.push(Math.cos(a) * r, Math.sin(a) * r); } return p; }
  function mapShape(s, f) { return shape(s.paths.map((pa) => { const p = new Array(pa.p.length); for (let i = 0; i < pa.p.length; i += 2) { const q = f(pa.p[i], pa.p[i + 1]); p[i] = q[0]; p[i + 1] = q[1]; } return path(p, pa.closed); })); }
  // insert points so no segment is longer than maxSeg (so warps can bend straight lines)
  function densify(s, maxSeg = 0.04, cap = 24000) {
    let total = 0;
    return shape(s.paths.map((pa) => {
      const out = [], n = pa.p.length / 2, segs = pa.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const x0 = pa.p[2 * i], y0 = pa.p[2 * i + 1], j = (i + 1) % n, x1 = pa.p[2 * j], y1 = pa.p[2 * j + 1];
        const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxSeg));
        for (let m = 0; m < k && total < cap; m++, total++) out.push(x0 + ((x1 - x0) * m) / k, y0 + ((y1 - y0) * m) / k);
      }
      if (!pa.closed) out.push(pa.p[2 * (n - 1)], pa.p[2 * (n - 1) + 1]);
      return path(out, pa.closed);
    }));
  }
  function resamplePath(pa, M) {
    const n = pa.p.length / 2, pts = [];
    for (let i = 0; i < n; i++) pts.push([pa.p[2 * i], pa.p[2 * i + 1]]);
    if (pa.closed) pts.push(pts[0]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = cum[cum.length - 1] || 1e-9, out = [];
    let seg = 0;
    for (let m = 0; m < M; m++) {
      const d = (L * m) / (pa.closed ? M : M - 1);
      while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
      const span = cum[seg + 1] - cum[seg] || 1e-9, f = clamp((d - cum[seg]) / span, 0, 1);
      out.push(pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * f, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * f);
    }
    return out;
  }
  const rot2 = (x, y, a) => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };

  // ---------- op registry ----------
  const P = (k, def, min, max, o = {}) => Object.assign({ k, def, min, max, type: 'num' }, o);
  const E = (k, opts, def) => ({ k, type: 'enum', opts, def: def || opts[0] });
  const C = (k, def) => ({ k, type: 'color', def });
  const NONE = {};

  const OPS = {
    // ===== sources (output: number 0..1) =====
    lfo: { fam: 'source', label: 'LFO', params: [P('freq', 0.25, 0.02, 4, { log: 1 }), P('amp', 1, 0, 1), P('off', 0.5, 0, 1), E('wave', ['sine', 'tri', 'saw', 'square'])], outs: { out: 'num' },
      eval(n, v, c) { const ph = ((c.t * v.freq) % 1 + 1) % 1; let w = v.wave === 'sine' ? Math.sin(TAU * ph) : v.wave === 'tri' ? 1 - 4 * Math.abs(ph - 0.5) : v.wave === 'saw' ? 2 * ph - 1 : ph < 0.5 ? 1 : -1; return { out: clamp(v.off + 0.5 * v.amp * w, 0, 1) }; } },
    noise: { fam: 'source', label: 'Noise', params: [P('rate', 0.6, 0.05, 8, { log: 1 }), P('seed', 1, 1, 50, { int: 1 })], outs: { out: 'num' },
      eval(n, v, c) { const s = n.s; if (s.seed !== v.seed) { s.seed = v.seed; s.r = rng(v.seed * 977); s.a = s.r(); s.b = s.r(); s.ph = 0; } s.ph += c.dt * v.rate; while (s.ph >= 1) { s.ph -= 1; s.a = s.b; s.b = s.r(); } const f = s.ph * s.ph * (3 - 2 * s.ph); return { out: s.a + (s.b - s.a) * f }; } },
    tele: { fam: 'source', label: 'Telemetry (mock)', params: [E('channel', CHANNELS), P('smooth', 0.4, 0, 0.98)], outs: { out: 'num' },
      eval(n, v) { const x = Tele.v[v.channel] || 0; n.s.y = n.s.y === undefined ? x : n.s.y + (x - n.s.y) * (1 - v.smooth); return { out: n.s.y }; } },
    curve: { fam: 'source', label: 'Drawn curve', params: [P('dur', 6, 0.5, 30, { log: 1 }), E('mode', ['loop', 'pingpong', 'once'])], outs: { out: 'num' }, studio: 'curve',
      eval(n, v, c) { let ph = c.t / v.dur; if (v.mode === 'once') ph = clamp(ph % 2 > 1 ? 1 : ph % 1, 0, 1); else if (v.mode === 'pingpong') { ph = ph % 2; if (ph > 1) ph = 2 - ph; } else ph = ph % 1; n.s.ph = ph; const L = n.curve.length, f = ph * (L - 1), i = Math.floor(f), j = Math.min(L - 1, i + 1); return { out: clamp(n.curve[i] + (n.curve[j] - n.curve[i]) * (f - i), 0, 1) }; } },
    spec: { fam: 'source', label: 'Painted spectrogram', params: [], outs: { low: 'num', mid: 'num', high: 'num' }, studio: 'spec',
      eval(n, v, c) { const S = c.SPEC, ph = c.specPhase ? c.specPhase(n) : (c.t / S.dur) % 1; n.s.ph = ph; const col = clamp(Math.floor(ph * S.W), 0, S.W - 1), H = S.H, th = H / 3; let lo = 0, mi = 0, hi = 0; for (let r = 0; r < H; r++) { const x = n.grid[r * S.W + col] / 255; if (r < th) hi += x; else if (r < 2 * th) mi += x; else lo += x; } return { low: clamp((lo / th) * 1.5, 0, 1), mid: clamp((mi / th) * 1.5, 0, 1), high: clamp((hi / th) * 1.5, 0, 1) }; } },
    smooth: { fam: 'source', label: 'Smooth (low-pass)', params: [P('in', 0.5, 0, 1), P('amt', 0.9, 0, 0.995)], outs: { out: 'num' },
      eval(n, v) { n.s.y = n.s.y === undefined ? v.in : n.s.y + (v.in - n.s.y) * (1 - v.amt); return { out: n.s.y }; } },
    math: { fam: 'source', label: 'Math (a ? b)', params: [P('a', 0.5, 0, 1), P('b', 0.5, 0, 1), E('op', ['add', 'mul', 'min', 'max', 'diff'])], outs: { out: 'num' },
      eval(n, v) { const o = v.op; return { out: clamp(o === 'add' ? (v.a + v.b) / 2 : o === 'mul' ? v.a * v.b : o === 'min' ? Math.min(v.a, v.b) : o === 'max' ? Math.max(v.a, v.b) : Math.abs(v.a - v.b), 0, 1) }; } },

    // ===== shapes (output: shape) =====
    polygon: { fam: 'shape', label: 'Polygon', params: [P('sides', 5, 3, 64, { int: 1 }), P('r', 0.6, 0.05, 1)], outs: { out: 'shape' },
      eval(n, v) { return { out: shape([path(polyPts(v.sides, v.r, -Math.PI / 2), true)]) }; } },
    star: { fam: 'shape', label: 'Star', params: [P('points', 5, 3, 12, { int: 1 }), P('r', 0.7, 0.05, 1), P('inner', 0.4, 0.1, 0.95)], outs: { out: 'shape' },
      eval(n, v) { const p = []; for (let i = 0; i < v.points * 2; i++) { const r = i % 2 ? v.r * v.inner : v.r, a = -Math.PI / 2 + (Math.PI * i) / v.points; p.push(Math.cos(a) * r, Math.sin(a) * r); } return { out: shape([path(p, true)]) }; } },
    lissa: { fam: 'shape', label: 'Lissajous', params: [P('a', 3, 1, 8, { int: 1 }), P('b', 2, 1, 8, { int: 1 }), P('phase', 0.25, 0, 1), P('r', 0.7, 0.05, 1)], outs: { out: 'shape' },
      eval(n, v) { const p = []; for (let i = 0; i < 240; i++) { const t = (TAU * i) / 240; p.push(Math.sin(v.a * t + v.phase * TAU) * v.r, Math.sin(v.b * t) * v.r); } return { out: shape([path(p, true)]) }; } },
    spiral: { fam: 'shape', label: 'Spiral', params: [P('turns', 3, 0.5, 10), P('r', 0.8, 0.05, 1)], outs: { out: 'shape' },
      eval(n, v) { const p = [], M = 260; for (let i = 0; i <= M; i++) { const f = i / M, a = v.turns * TAU * f; p.push(Math.cos(a) * v.r * f, Math.sin(a) * v.r * f); } return { out: shape([path(p, false)]) }; } },
    blob: { fam: 'shape', label: 'Blob', params: [P('r', 0.5, 0.05, 1), P('wobble', 0.3, 0, 0.8), P('speed', 0.5, 0, 3)], outs: { out: 'shape' },
      eval(n, v, c) { n.s.t = (n.s.t || 0) + c.dt * v.speed; const t = n.s.t, p = []; for (let i = 0; i < 120; i++) { const a = (TAU * i) / 120, rr = v.r * (1 + v.wobble * (0.5 * Math.sin(3 * a + t) + 0.3 * Math.sin(5 * a - 1.3 * t) + 0.2 * Math.sin(2 * a + 0.7 * t))); p.push(Math.cos(a) * rr, Math.sin(a) * rr); } return { out: shape([path(p, true)]) }; } },
    grid: { fam: 'shape', label: 'Grid (test pattern)', params: [P('cells', 8, 2, 16, { int: 1 }), P('size', 0.8, 0.1, 1)], outs: { out: 'shape' },
      eval(n, v) { const ps = [], k = v.cells, s = v.size; for (let i = 0; i <= k; i++) { const u = -s + (2 * s * i) / k; ps.push(path([u, -s, u, s], false), path([-s, u, s, u], false)); } return { out: shape(ps) }; } },

    // ===== transformers (input: shape, output: shape) =====
    move: { fam: 'xform', label: 'Move', ports: { shape: 'shape' }, params: [P('x', 0, -1, 1), P('y', 0, -1, 1)], outs: { out: 'shape' },
      eval(n, v, c, i) { return { out: i.shape ? mapShape(i.shape, (x, y) => [x + v.x, y + v.y]) : null }; } },
    scale: { fam: 'xform', label: 'Scale', ports: { shape: 'shape' }, params: [P('s', 1, 0.05, 2.5), P('squeeze', 1, 0.2, 3)], outs: { out: 'shape' },
      eval(n, v, c, i) { return { out: i.shape ? mapShape(i.shape, (x, y) => [x * v.s * v.squeeze, y * v.s]) : null }; } },
    rotate: { fam: 'xform', label: 'Rotate', ports: { shape: 'shape' }, params: [P('deg', 0, -180, 180)], outs: { out: 'shape' },
      eval(n, v, c, i) { const a = (v.deg * Math.PI) / 180; return { out: i.shape ? mapShape(i.shape, (x, y) => rot2(x, y, a)) : null }; } },
    mirror: { fam: 'xform', label: 'Mirror / kaleidoscope', ports: { shape: 'shape' }, params: [P('n', 3, 1, 12, { int: 1 }), E('flip', ['no', 'yes'])], outs: { out: 'shape' },
      eval(n, v, c, i) { if (!i.shape) return { out: null }; const ps = []; for (let k = 0; k < v.n; k++) { const a = (TAU * k) / v.n; const s = mapShape(i.shape, (x, y) => rot2(x, y, a)); ps.push(...s.paths); if (v.flip === 'yes') ps.push(...mapShape(i.shape, (x, y) => rot2(-x, y, a)).paths); } return { out: shape(ps) }; } },
    repeat: { fam: 'xform', label: 'Repeat (echo)', ports: { shape: 'shape' }, params: [P('count', 6, 1, 14, { int: 1 }), P('rot', 8, -40, 40), P('shrink', 0.88, 0.6, 1), P('dx', 0, -0.2, 0.2)], outs: { out: 'shape' },
      eval(n, v, c, i) { if (!i.shape) return { out: null }; const ps = []; for (let k = 0; k < v.count; k++) { const a = (v.rot * Math.PI * k) / 180, s = Math.pow(v.shrink, k); ps.push(...mapShape(i.shape, (x, y) => { const q = rot2(x * s, y * s, a); return [q[0] + v.dx * k, q[1]]; }).paths); } return { out: shape(ps) }; } },
    warp: { fam: 'xform', label: 'Warp (Scanimate bend)', ports: { shape: 'shape' }, params: [P('ampx', 0.1, 0, 0.5), P('ampy', 0.1, 0, 0.5), P('freq', 1.5, 0.2, 6), P('phase', 0, 0, 1)], outs: { out: 'shape' },
      eval(n, v, c, i) { if (!i.shape) return { out: null }; const ph = v.phase * TAU; return { out: mapShape(densify(i.shape), (x, y) => [x + v.ampx * Math.sin(TAU * v.freq * y + ph), y + v.ampy * Math.sin(TAU * v.freq * x + ph)]) }; } },
    twist: { fam: 'xform', label: 'Twist', ports: { shape: 'shape' }, params: [P('amt', 0, -4, 4)], outs: { out: 'shape' },
      eval(n, v, c, i) { return { out: i.shape ? mapShape(densify(i.shape), (x, y) => rot2(x, y, v.amt * Math.hypot(x, y))) : null }; } },
    morph: { fam: 'xform', label: 'Morph A to B', ports: { a: 'shape', b: 'shape' }, params: [P('t', 0.5, 0, 1)], outs: { out: 'shape' },
      eval(n, v, c, i) { if (!i.a || !i.b) return { out: i.a || i.b || null }; const M = 160, cnt = Math.max(i.a.paths.length, i.b.paths.length), ps = []; for (let k = 0; k < cnt; k++) { const pa = i.a.paths[k % i.a.paths.length], pb = i.b.paths[k % i.b.paths.length], ra = resamplePath(pa, M), rb = resamplePath(pb, M), p = new Array(2 * M); for (let m = 0; m < 2 * M; m++) p[m] = ra[m] + (rb[m] - ra[m]) * v.t; ps.push(path(p, pa.closed && pb.closed)); } return { out: shape(ps) }; } },

    // ===== palettes (output: palette) =====
    palette: { fam: 'palette', label: 'Palette', params: [E('preset', Object.keys(PRESETS)), P('shift', 0, 0, 1), P('steps', 0, 0, 12, { int: 1 }), P('gamma', 1, 0.3, 2.5)], outs: { out: 'pal' },
      eval(n, v) { return { out: { colors: PRESETS[v.preset], shift: v.shift, steps: v.steps, gamma: v.gamma } }; } },
    gradient: { fam: 'palette', label: 'Gradient (3 colours)', params: [C('c1', '#05010f'), C('c2', '#ff3d81'), C('c3', '#fff3b0'), P('shift', 0, 0, 1), P('steps', 0, 0, 12, { int: 1 }), P('gamma', 1, 0.3, 2.5)], outs: { out: 'pal' },
      eval(n, v) { return { out: { colors: [v.c1, v.c2, v.c3], shift: v.shift, steps: v.steps, gamma: v.gamma } }; } },

    // ===== singletons: render (colorizer + feedback) and mask filter =====
    render: { fam: 'render', label: 'Render: feedback + colorizer', single: true, ports: { shape: 'shape', shape2: 'shape', pal: 'pal' },
      params: [P('bright', 0.7, 0.1, 1), P('width', 1.2, 0.5, 6), P('glow', 3, 0, 24), P('fb', 0.82, 0, 0.985), P('zoom', 1.006, 0.97, 1.04), P('rot', 0.3, -4, 4), P('cycle', 0, 0, 1)], outs: {},
      eval() { return {}; } },
    mask: { fam: 'render', label: 'Mask filter (draw on the 2D spectrum)', single: true, studio: 'mask', params: [E('on', ['off', 'on']), P('mix', 1, 0, 1), E('inloop', ['no', 'yes'])], outs: { energy: 'num' },
      eval(n) { return { energy: n.s.energy || 0 }; } },
  };

  // ---------- graph ----------
  const CURVE_N = 256;
  function defaultCurve() { const a = new Float32Array(CURVE_N); for (let i = 0; i < CURVE_N; i++) a[i] = 0.5 + 0.4 * Math.sin((TAU * i) / CURVE_N); return a; }
  function defaultGrid(SPEC) {
    const g = new Uint8Array(SPEC.W * SPEC.H);
    for (let x = 0; x < SPEC.W; x++) {
      const y1 = Math.round(48 + 30 * Math.sin((x / SPEC.W) * TAU * 1.5)), y2 = Math.round(30 - 10 * Math.cos((x / SPEC.W) * TAU));
      for (const [y, v] of [[y1, 220], [y2, 150]]) for (let d = -1; d <= 1; d++) { const yy = y + d; if (yy >= 0 && yy < SPEC.H) g[yy * SPEC.W + x] = Math.max(g[yy * SPEC.W + x], v - Math.abs(d) * 60); }
    }
    return g;
  }
  function makeNode(op, id, extra = {}) {
    const def = OPS[op]; if (!def) throw new Error('unknown op ' + op);
    const n = { id, op, p: {}, in: {}, s: {} };
    for (const pr of def.params) n.p[pr.k] = pr.def;
    if (op === 'curve') n.curve = defaultCurve();
    if (op === 'spec') n.grid = defaultGrid(g.DSP ? g.DSP.SPEC : (extra.SPEC || { W: 256, H: 96 }));
    if (op === 'mask') n.mask = new Float32Array(256 * 256).fill(1);
    return n;
  }
  function newGraph() { return { nodes: {}, counter: {} }; }
  function addNode(gr, op, id) {
    if (!id) { gr.counter[op] = (gr.counter[op] || 0) + 1; id = op + gr.counter[op]; while (gr.nodes[id]) { gr.counter[op]++; id = op + gr.counter[op]; } }
    gr.nodes[id] = makeNode(op, id); return gr.nodes[id];
  }
  function removeNode(gr, id) {
    if (OPS[gr.nodes[id].op].single) return;
    delete gr.nodes[id];
    for (const n of Object.values(gr.nodes)) for (const k of Object.keys(n.in)) if (n.in[k] && n.in[k].from === id) delete n.in[k];
  }
  function connect(gr, toId, port, fromId, fromPort) {
    if (fromId == null) { delete gr.nodes[toId].in[port]; return; }
    gr.nodes[toId].in[port] = { from: fromId, port: fromPort || 'out' };
  }
  const mapParam = (pr, s) => { let x; if (pr.log) x = pr.min * Math.pow(pr.max / pr.min, s); else x = pr.min + (pr.max - pr.min) * s; return pr.int ? Math.round(x) : x; };
  const unmapParam = (pr, x) => (pr.log ? Math.log(x / pr.min) / Math.log(pr.max / pr.min) : (x - pr.min) / (pr.max - pr.min));

  // ctx: { t, dt, outs (last frame outs), SPEC, specPhase }
  function evaluate(gr, ctx) {
    const state = {}, order = [], last = ctx.outs || {}, outs = {}, resolved = {}, inputs = {};
    const visit = (id) => { const n = gr.nodes[id]; if (!n || state[id]) return; state[id] = 1; for (const r of Object.values(n.in)) if (r && gr.nodes[r.from]) visit(r.from); state[id] = 2; order.push(id); };
    for (const id of Object.keys(gr.nodes)) visit(id);
    const read = (r) => { const src = outs[r.from] || last[r.from]; return src ? src[r.port || 'out'] : undefined; };
    for (const id of order) {
      const n = gr.nodes[id], def = OPS[n.op], v = {}, ins = {};
      for (const pr of def.params) {
        if (pr.type === 'num') { const r = n.in[pr.k]; let s; if (r) s = read(r); v[pr.k] = typeof s === 'number' ? mapParam(pr, clamp(s, 0, 1)) : n.p[pr.k]; if (pr.int) v[pr.k] = Math.round(v[pr.k]); } else v[pr.k] = n.p[pr.k];
      }
      for (const port of Object.keys(def.ports || {})) { const r = n.in[port]; ins[port] = r ? read(r) || null : null; }
      outs[id] = def.eval(n, v, ctx, ins) || NONE;
      resolved[id] = v; inputs[id] = ins;
    }
    ctx.outs = outs; ctx.resolved = resolved; ctx.ins = inputs;
    return outs;
  }

  // ---------- (de)serialize ----------
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return typeof btoa !== 'undefined' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); };
  const unb64 = (str) => { const s = typeof atob !== 'undefined' ? atob(str) : Buffer.from(str, 'base64').toString('binary'); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  function serialize(gr) {
    const nodes = Object.values(gr.nodes).map((n) => { const o = { id: n.id, op: n.op, p: n.p, in: n.in }; if (n.curve) o.curve = Array.from(n.curve, (x) => +x.toFixed(4)); if (n.grid) o.grid = b64(n.grid); if (n.mask) o.mask = b64(Uint8Array.from(n.mask, (x) => Math.round(clamp(x, 0, 1) * 255))); return o; });
    return JSON.stringify({ v: 1, nodes, counter: gr.counter });
  }
  function deserialize(str) {
    const d = JSON.parse(str), gr = newGraph(); gr.counter = d.counter || {};
    for (const o of d.nodes) {
      if (!OPS[o.op]) continue;
      const n = makeNode(o.op, o.id); Object.assign(n.p, o.p); n.in = o.in || {};
      if (o.curve) n.curve = Float32Array.from(o.curve);
      if (o.grid) n.grid = unb64(o.grid);
      if (o.mask) n.mask = Float32Array.from(unb64(o.mask), (x) => x / 255);
      gr.nodes[o.id] = n;
    }
    return gr;
  }

  function defaultGraph() {
    const gr = newGraph();
    addNode(gr, 'render', 'render'); addNode(gr, 'mask', 'mask');
    const lfo = addNode(gr, 'lfo'); lfo.p.freq = 0.12;
    const tele = addNode(gr, 'tele');
    const star = addNode(gr, 'star'); star.p.points = 5;
    const warp = addNode(gr, 'warp'); const rot = addNode(gr, 'rotate'); const rep = addNode(gr, 'repeat');
    const pal = addNode(gr, 'palette');
    connect(gr, rot.id, 'shape', star.id); connect(gr, rot.id, 'deg', lfo.id);
    connect(gr, warp.id, 'shape', rot.id); connect(gr, warp.id, 'ampx', tele.id); gr.nodes[warp.id].p.ampy = 0.06;
    connect(gr, rep.id, 'shape', warp.id);
    connect(gr, 'render', 'shape', rep.id); connect(gr, 'render', 'pal', pal.id);
    const cv = addNode(gr, 'curve'); connect(gr, rep.id, 'rot', cv.id);   // drawn curve bends the echo angle
    const sp = addNode(gr, 'spec'); connect(gr, warp.id, 'phase', sp.id, 'mid'); // painted spectrogram moves the warp phase
    return gr;
  }


  // ---------- paint-a-program: colour regions on a grid become modules ----------
  // Rules (my own simple rules, NOT Piet): same colour touching by edge = one region = one module.
  // Different regions that touch are wired: lower family rank -> higher rank (source < shape < transform = palette < render).
  // The wire goes into the first free input of the matching type. Region size sets one chosen parameter.
  const PAINT = [
    { op: 'lfo', c: '#e63946', name: 'LFO', size: 'freq' },
    { op: 'tele', c: '#f4a261', name: 'Telemetry', size: null },
    { op: 'smooth', c: '#e9c46a', name: 'Smooth', size: 'amt' },
    { op: 'star', c: '#2a9d8f', name: 'Star', size: 'r' },
    { op: 'lissa', c: '#8ac926', name: 'Lissajous', size: 'r' },
    { op: 'warp', c: '#4cc9f0', name: 'Warp', size: null },
    { op: 'rotate', c: '#4361ee', name: 'Rotate', size: null },
    { op: 'repeat', c: '#9d4edd', name: 'Repeat', size: 'count' },
    { op: 'palette', c: '#f72585', name: 'Palette', size: null },
    { op: 'render', c: '#f5f5f5', name: 'Render', size: null },
  ];
  const RANK = { source: 0, shape: 1, xform: 2, palette: 2, render: 3 };
  function compilePaint(cells, W, H, old) {
    const rep = [], lab = new Int16Array(W * H).fill(-1), regs = [];
    for (let i = 0; i < W * H; i++) {
      if (!cells[i] || lab[i] >= 0) continue;
      const r = { v: cells[i], cells: [], sx: 0 }, q = [i]; lab[i] = regs.length;
      while (q.length) { const c = q.pop(); r.cells.push(c); r.sx += c % W; const x = c % W, y = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (cells[j] === r.v && lab[j] < 0) { lab[j] = regs.length; q.push(j); } } }
      r.cx = r.sx / r.cells.length; r.op = PAINT[r.v - 1].op; regs.push(r);
    }
    const touch = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = lab[y * W + x]; if (a < 0) continue; for (const [dx, dy] of [[1, 0], [0, 1]]) { const nx = x + dx, ny = y + dy; if (nx >= W || ny >= H) continue; const b = lab[ny * W + nx]; if (b >= 0 && b !== a) touch.add(Math.min(a, b) * 10000 + Math.max(a, b)); } }
    const gr = newGraph(); gr.nodes.render = old.nodes.render; gr.nodes.mask = old.nodes.mask; gr.nodes.render.in = {};
    gr.counter = {};
    const ids = regs.map((r) => (r.op === 'render' ? 'render' : addNode(gr, r.op).id));
    const used = (id, port) => !!gr.nodes[id].in[port];
    const freePort = (id, type) => {
      const def = OPS[gr.nodes[id].op];
      for (const [pt, ty] of Object.entries(def.ports || {})) if (ty === type && !used(id, pt)) return pt;
      if (type === 'num') for (const pr of def.params) if (pr.type === 'num' && !used(id, pr.k)) return pr.k;
      return null;
    };
    const accepts = (id, type) => { const def = OPS[gr.nodes[id].op]; return Object.values(def.ports || {}).includes(type) || (type === 'num' && def.params.some((p) => p.type === 'num')); };
    const pairs = [...touch].map((k) => [Math.floor(k / 10000), k % 10000]).sort((p, q) => regs[p[0]].cx - regs[q[0]].cx);
    for (const [a, b] of pairs) {
      const ra = RANK[OPS[regs[a].op].fam], rb = RANK[OPS[regs[b].op].fam];
      let s, d;
      if (ra < rb) { s = a; d = b; } else if (rb < ra) { s = b; d = a; } else if (OPS[regs[a].op].fam === 'xform' && OPS[regs[b].op].fam === 'xform') { [s, d] = regs[a].cx <= regs[b].cx ? [a, b] : [b, a]; } else continue;
      const type = Object.values(OPS[regs[s].op].outs)[0];
      if (!accepts(ids[d], type)) continue;
      const port = freePort(ids[d], type);
      if (!port) { rep.push(`! ${ids[s]} touches ${ids[d]} but ${ids[d]} has no free ${type} input`); continue; }
      connect(gr, ids[d], port, ids[s]); rep.push(`${ids[s]} -> ${ids[d]}.${port}`);
    }
    regs.forEach((r, i) => {
      const sz = PAINT[r.v - 1].size; if (!sz || used(ids[i], sz)) return;
      const pr = OPS[r.op].params.find((p) => p.k === sz), f = clamp(r.cells.length / 16, 0.15, 1);
      gr.nodes[ids[i]].p[sz] = mapParam(pr, f); rep.push(`${ids[i]}: size ${r.cells.length} cells -> ${sz} = ${gr.nodes[ids[i]].p[sz].toFixed(2)}`);
    });
    if (!regs.some((r) => r.op === 'render')) rep.push('! no white region: nothing is wired to Render');
    return { graph: gr, report: rep, regions: regs.length };
  }


  // ASCII helper + the example shown in the UI (tested in test_paint.js)
  const PAINT_KEYS = { L: 1, T: 2, M: 3, S: 4, Y: 5, W: 6, R: 7, P: 8, C: 9, X: 10 };
  const PAINT_EXAMPLE = [
    'LLL.TTTT............',
    'LLL.WWWWWWWWXXXXXXXX',
    'RRRRWWWWWWWWXXXXXXXX',
    'SSS.WWWWWWWWCCCCCCCC',
    'SSS.................',
    'SSS.................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
  ];
  function paintFromArt(art, W = 20, H = 12) {
    const cells = new Uint8Array(W * H);
    art.forEach((row, y) => [...row].forEach((ch, x) => { if (PAINT_KEYS[ch] && x < W && y < H) cells[y * W + x] = PAINT_KEYS[ch]; }));
    return cells;
  }

  const api = { PAINT_EXAMPLE, paintFromArt, PAINT, compilePaint, OPS, PRESETS, CHANNELS, Tele, rng, makeLUT, newGraph, addNode, removeNode, connect, evaluate, serialize, deserialize, defaultGraph, mapParam, unmapParam, mapShape, densify, resamplePath, CURVE_N, hex2rgb };
  if (typeof module !== 'undefined' && module.exports) { g.DSP = g.DSP || require('./dsp.js'); module.exports = api; } else g.CORE = api;
})(typeof window !== 'undefined' ? window : globalThis);
