// graph.js — the model and the evaluator.
//
// A graph is nodes plus edges. Evaluation is pull-free: nodes are sorted once
// into a dependency order and then run in that order every frame, which is
// cheaper than a demand-driven walk and makes stateful operators behave
// predictably (each one is stepped exactly once per frame, never zero or twice).
//
// Cycles are allowed on purpose. Kahn's algorithm resolves what it can; any
// node left in a cycle is appended afterwards, and because each node keeps its
// previous outputs, a back-edge simply reads last frame's value. That is a
// one-frame delay, which is what feedback means in a frame-based system.

import { OPS, DESTS } from './ops.js';

let _id = 0;
export const newId = () => 'n' + (++_id) + Math.random().toString(36).slice(2, 5);

export class Graph {
  constructor() { this.nodes = new Map(); this.edges = []; this.order = []; this.dirty = true; }

  add(type, x = 40, y = 40, params) {
    const op = OPS[type];
    if (!op) throw new Error('unknown op: ' + type);
    const p = {};
    for (const q of op.params) p[q.k] = q.def;
    Object.assign(p, params || {});
    const n = { id: newId(), type, x, y, p, s: op.init(), o: new Array(op.outs.length).fill(0) };
    this.nodes.set(n.id, n);
    this.dirty = true;
    return n;
  }

  remove(id) {
    this.nodes.delete(id);
    this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
    this.dirty = true;
  }

  // Why a connection was refused, for the editor to show. Set by connect().
  // Null after a successful connection.
  lastRefusal = null;

  // Two values travel on wires: numbers and shapes (distance fields). They
  // are not interchangeable, and a shape arriving at a numeric input would
  // read as "no input" with no visible error at all — so refuse it here
  // rather than let someone spend an hour on a silently dead patch.
  portType(nodeId, dir, i) {
    const n = this.nodes.get(nodeId);
    if (!n) return null;
    const op = OPS[n.type];
    const p = op && (dir === 'out' ? op.outs[i] : op.ins[i]);
    return p ? (p.shape ? 'shape' : p.seltype ? 'sel' : 'num') : null;
  }

  // One source per input port: connecting replaces whatever was there.
  connect(from, fo, to, ti) {
    this.lastRefusal = null;
    if (from === to) { this.lastRefusal = 'a node cannot feed itself'; return false; }
    const a = this.portType(from, 'out', fo), b = this.portType(to, 'in', ti);
    if (!a || !b) { this.lastRefusal = 'that port does not exist'; return false; }
    if (a !== b) {
      const name = { shape:'a shape', sel:'a selection', num:'a number' };
      this.lastRefusal = `${name[a]} cannot drive ${name[b]} input`
        + (a === 'sel' || b === 'sel' ? ' — selection ports are diamonds' : '')
        + (a === 'shape' || b === 'shape' ? ' — shape ports are square' : '');
      return false;
    }
    this.edges = this.edges.filter(e => !(e.to === to && e.ti === ti));
    this.edges.push({ from, fo, to, ti });
    this.dirty = true;
    return true;
  }

  disconnect(to, ti) {
    this.edges = this.edges.filter(e => !(e.to === to && e.ti === ti));
    this.dirty = true;
  }

  compile() {
    const ids = [...this.nodes.keys()];
    const indeg = new Map(ids.map(i => [i, 0]));
    const outs = new Map(ids.map(i => [i, []]));
    for (const e of this.edges) {
      if (!this.nodes.has(e.from) || !this.nodes.has(e.to)) continue;
      indeg.set(e.to, indeg.get(e.to) + 1);
      outs.get(e.from).push(e.to);
    }
    const q = ids.filter(i => indeg.get(i) === 0);
    const order = [];
    while (q.length) {
      const i = q.shift();
      order.push(i);
      for (const j of outs.get(i)) { indeg.set(j, indeg.get(j) - 1); if (indeg.get(j) === 0) q.push(j); }
    }
    const left = ids.filter(i => !order.includes(i));      // whatever sits in a cycle
    this.order = order.concat(left);
    this.cycles = left.length;
    this.dirty = false;
  }

  // ctx: { dt, t, raw, labels }. Returns the sink values written this frame.
  //
  // Scalar sinks arrive as out['scan.amp'] and so on. Two reserved keys carry
  // the non-scalar results, and cannot collide because every real sink name
  // contains a dot and none begins with $:
  //
  //   out.$shapes   the fields the Fill and Contour operators asked for, in
  //                 evaluation order, each with its own render settings
  //   out.$color    the colouriser configuration, if any node set one
  //   out.$text     the typography modulator stack, top-to-bottom by node
  //   out.$layout   the surface modulator stack, top-to-bottom by node
  eval(ctx) {
    if (this.dirty) this.compile();
    const out = {};
    const shapes = [], text = [], layoutMods = [];
    ctx.out = out;
    ctx.shapes = shapes;
    ctx.text = text;
    ctx.layout = layoutMods;
    // index edges by target for cheap lookup
    if (this.dirty || !this._byTarget) {
      this._byTarget = new Map();
      for (const e of this.edges) {
        if (!this._byTarget.has(e.to)) this._byTarget.set(e.to, []);
        this._byTarget.get(e.to).push(e);
      }
    }
    for (const id of this.order) {
      const n = this.nodes.get(id);
      if (!n) continue;
      const op = OPS[n.type];
      if (!op) continue;
      const inc = this._byTarget.get(id);
      const vals = new Array(op.ins.length).fill(null);
      if (inc) for (const e of inc) {
        const src = this.nodes.get(e.from);
        if (src) vals[e.ti] = src.o[e.fo];
      }
      // Operators that push onto a stack need to know where their node sits,
      // so the stack can be ordered by position instead of by whatever the
      // topological sort happened to produce.
      ctx.node = n;
      // Whatever this operator pushes onto a stack gets stamped with the node
      // that produced it. Without that, the renderer knows what to do but not
      // who asked for it, so it cannot report back "this block reached 412
      // glyphs" — and a block that reaches nothing looks exactly like a block
      // that is working.
      const mark = [text.length, layoutMods.length, shapes.length];
      try { n.o = op.eval(n.p, vals, n.s, ctx) || []; n.err = null; }
      catch (err) { n.err = String(err && err.message || err); n.o = n.o.map(() => 0); }
      for (let k = mark[0]; k < text.length; k++) text[k]._id = id;
      for (let k = mark[1]; k < layoutMods.length; k++) layoutMods[k]._id = id;
      for (let k = mark[2]; k < shapes.length; k++) shapes[k]._id = id;
    }
    if (shapes.length) out.$shapes = shapes;
    if (text.length) {
      // Typography modulators apply in TOP-TO-BOTTOM order of their nodes on
      // the canvas, like a layer stack. Order matters here — a Cascade delay
      // only affects what comes after it — and evaluation order would have
      // been effectively arbitrary for nodes with no wires between them.
      text.sort((a, b) => (a._y - b._y) || (a._x - b._x));
      out.$text = text;
    }
    if (layoutMods.length) {
      layoutMods.sort((a, b) => (a._y - b._y) || (a._x - b._x));
      out.$layout = layoutMods;
    }
    return out;
  }

  toJSON() {
    return {
      v: 1,
      nodes: [...this.nodes.values()].map(n => ({ id: n.id, type: n.type, x: Math.round(n.x), y: Math.round(n.y), p: n.p })),
      edges: this.edges.map(e => ({ from: e.from, fo: e.fo, to: e.to, ti: e.ti })),
    };
  }

  static fromJSON(j) {
    const g = new Graph();
    if (!j || !Array.isArray(j.nodes)) return g;
    for (const nd of j.nodes) {
      const op = OPS[nd.type];
      if (!op) continue;                                    // drop ops this build does not have
      const p = {};
      for (const q of op.params) p[q.k] = nd.p && nd.p[q.k] !== undefined ? nd.p[q.k] : q.def;
      const n = { id: nd.id, type: nd.type, x: nd.x || 0, y: nd.y || 0, p, s: op.init(), o: new Array(op.outs.length).fill(0) };
      g.nodes.set(n.id, n);
    }
    for (const e of (j.edges || [])) {
      if (!g.nodes.has(e.from) || !g.nodes.has(e.to)) continue;
      const fo = e.fo | 0, ti = e.ti | 0;
      // Drop anything that no longer type-checks: a hand-edited patch.json, or
      // one saved before an operator's ports changed shape.
      if (g.portType(e.from, 'out', fo) !== g.portType(e.to, 'in', ti)) continue;
      g.edges.push({ from: e.from, fo, to: e.to, ti });
    }
    g.dirty = true;
    return g;
  }
}

// ---------------------------------------------------------------- default
// Reproduces exactly what the renderer did when the patch was hardcoded, so
// loading it changes nothing on screen, plus a DSP bench at the bottom whose
// operators are wired to scopes and not yet to any output.

const BUS_REF = {
  net_in: 2.0e6, net_out: 1.0e6, disk_in: 180, disk_out: 2500, fault: 2.0e5,
  cow: 2.0e4, pagein: 1500, pageout: 1200, compress: 6000, decomp: 6000,
  input: 50, fsev: 12,
};
const BUS_CH = {
  net_in:'net.in_bytes_per_s', net_out:'net.out_bytes_per_s', disk_in:'disk.mb_per_s',
  disk_out:'disk.tps', fault:'vm.faults_per_s', cow:'vm.cow_per_s',
  pagein:'vm.pageins_per_s', pageout:'vm.pageouts_per_s', compress:'vm.compress_per_s',
  decomp:'vm.decompress_per_s', input:'in.events', fsev:'fs.events',
};

export function defaultGraph() {
  const g = new Graph();
  const C = { src: 60, mid: 330, lpf: 600, out: 870 };
  let y = 60;

  // --- the twelve bus chains: channel -> normalise -> smooth -> emission ----
  for (const [bus, ch] of Object.entries(BUS_CH)) {
    const a = g.add('channel', C.src, y, { ch });
    const b = g.add('norm',    C.mid, y, { ref: BUS_REF[bus], track: 'on' });
    const c = g.add('lowpass', C.lpf, y, { cut: 1.8 });
    const d = g.add('out',     C.out, y, { dest: 'bus.' + bus, mode: 'set' });
    g.connect(a.id, 0, b.id, 0);
    g.connect(b.id, 0, c.id, 0);
    g.connect(c.id, 0, d.id, 0);
    y += 108;
  }

  // --- CPU load drives the scan processor and the feedback warp ------------
  let yy = 60;
  const cpu  = g.add('channel', C.src + 1180, yy, { ch: 'cpu.busy_pct' });
  const busy = g.add('scale',   C.src + 1400, yy, { mul: 0.01, add: 0 });
  const bsm  = g.add('lowpass', C.src + 1600, yy, { cut: 1.2 });
  g.connect(cpu.id, 0, busy.id, 0);
  g.connect(busy.id, 0, bsm.id, 0);

  const warp = [
    ['scan.amp',   26,    116],
    ['scan.persp', 0.40,  0.62],
    ['fb.zoom',    1.0010, 1.0040],
    ['fb.rot',     0.0003, 0.0011],
  ];
  yy = 60;
  for (const [dest, lo, hi] of warp) {
    const r = g.add('remap', C.src + 1820, yy, { il: 0, ih: 1, ol: lo, oh: hi, cl: 'on' });
    const o = g.add('out',   C.src + 2050, yy, { dest, mode: 'set' });
    g.connect(bsm.id, 0, r.id, 0);
    g.connect(r.id, 0, o.id, 0);
    yy += 104;
  }

  // --- memory pressure opens the colour key and kills travellers -----------
  const po   = g.add('channel', C.src + 1180, 480, { ch: 'vm.pageouts_per_s' });
  const pn   = g.add('norm',    C.src + 1400, 480, { ref: 900, track: 'off' });
  const pk   = g.add('remap',   C.src + 1820, 480, { il: 0, ih: 1, ol: 0.50, oh: 0.28, cl: 'on' });
  const pko  = g.add('out',     C.src + 2050, 480, { dest: 'scan.key', mode: 'set' });
  const pth  = g.add('threshold', C.src + 1600, 596, { lvl: 0.75, hys: 0.06 });
  const pdm  = g.add('scale',   C.src + 1820, 596, { mul: 0.12, add: 0 });
  const pdo  = g.add('out',     C.src + 2050, 596, { dest: 'hero.deathProb', mode: 'set' });
  g.connect(po.id, 0, pn.id, 0);
  g.connect(pn.id, 0, pk.id, 0);
  g.connect(pk.id, 0, pko.id, 0);
  g.connect(pn.id, 0, pth.id, 0);
  g.connect(pth.id, 0, pdm.id, 0);
  g.connect(pdm.id, 0, pdo.id, 0);

  // --- retransmits tear the raster ----------------------------------------
  const rtx = g.add('channel',  C.src + 1180, 712, { ch: 'net.retx_per_s' });
  const rn  = g.add('norm',     C.src + 1400, 712, { ref: 20, track: 'off' });
  const rE  = g.add('envelope', C.src + 1600, 712, { a: 5, r: 900 });
  const rs  = g.add('scale',    C.src + 1820, 712, { mul: 0.6, add: 0 });
  const ro  = g.add('out',      C.src + 2050, 712, { dest: 'scan.skew', mode: 'set' });
  g.connect(rtx.id, 0, rn.id, 0);
  g.connect(rn.id, 0, rE.id, 0);
  g.connect(rE.id, 0, rs.id, 0);
  g.connect(rs.id, 0, ro.id, 0);

  // --- DSP bench: wired to scopes, not to the image. Yours to patch. -------
  const BY = 1420;
  const d1 = g.add('channel',  C.src,        BY,       { ch: 'disk.tps' });
  const cv = g.add('convolve', C.src + 240,  BY,       { kind: 'exp', len: 2, rate: 30, gain: 1 });
  const ac = g.add('autocorr', C.src + 470,  BY,       { win: 40, rate: 10, lo: 0.5, hi: 20 });
  const s1 = g.add('scope',    C.src + 730,  BY,       { span: 40 });
  g.connect(d1.id, 0, cv.id, 0);
  g.connect(cv.id, 0, ac.id, 0);
  g.connect(ac.id, 1, s1.id, 0);                        // strength into the scope

  const d2 = g.add('channel',  C.src,        BY + 150, { ch: 'vm.faults_per_s' });
  const xc = g.add('xcorr',    C.src + 470,  BY + 150, { win: 40, rate: 10, max: 5 });
  const s2 = g.add('scope',    C.src + 730,  BY + 150, { span: 40 });
  g.connect(d1.id, 0, xc.id, 0);
  g.connect(d2.id, 0, xc.id, 1);
  g.connect(xc.id, 0, s2.id, 0);                        // lag into the scope

  const d3 = g.add('channel',     C.src,       BY + 300, { ch: 'net.in_bytes_per_s' });
  const br = g.add('bandresynth', C.src + 240, BY + 300, { n: '512', rate: 10, lo: 0.1, hi: 0.3 });
  const s3 = g.add('scope',       C.src + 730, BY + 300, { span: 60 });
  const sp = g.add('spectrum',    C.src + 470, BY + 440, { n: '256', rate: 30, lo: 0.1, hi: 1 });
  const s4 = g.add('scope',       C.src + 730, BY + 440, { span: 40 });
  g.connect(d3.id, 0, br.id, 0);
  g.connect(br.id, 0, s3.id, 0);
  g.connect(d3.id, 0, sp.id, 0);
  g.connect(sp.id, 0, s4.id, 0);

  return g;
}

export const DEST_RANGE = Object.fromEntries(DESTS.map(d => [d[0], [d[1], d[2]]]));

// ---------------------------------------------------------------- demo
// A Scanimate chain, added to whatever is already on the canvas rather than
// replacing it. It is laid out below the DSP bench and wires nothing to the
// existing scalar sinks, so adding it cannot fight the patch you already have.
//
// What it builds, and why each piece is there:
//
//   cpu.busy_pct -> star radius        the shape's size is a measurement
//   drawn ramp   -> rotation           motion from a curve you drew, not a tween
//   cpu.busy_pct -> squeeze amount     Scanimate's signature taper
//   star + ring  -> smooth blend       two objects becoming one and parting
//   -> contour, 4 rings                concentric slices of one distance field
//   cpu.busy_pct -> keyer edge 1       a colour boundary that slides on load
//   disk.tps     -> drawn FIR kernel   a filter whose coefficients are a drawing
//
// Everything in it is a measurement or a drawing. Nothing is a constant that
// happens to look nice.

export function scanimateDemo(g) {
  const before = g.nodes.size;
  const Y = 1900;

  // --- the driver ---------------------------------------------------------
  const cpu = g.add('channel', 60,  Y, { ch: 'cpu.busy_pct' });
  const sc  = g.add('scale',   300, Y, { mul: 0.01, add: 0 });
  const lp  = g.add('lowpass', 520, Y, { cut: 1.2 });
  g.connect(cpu.id, 0, sc.id, 0);
  g.connect(sc.id, 0, lp.id, 0);

  // --- the shape chain ----------------------------------------------------
  const rr  = g.add('remap',    60,  Y + 170, { il:0, ih:1, ol:0.10, oh:0.26, cl:'on' });
  const st  = g.add('sdf.star', 300, Y + 170, { x:0.34, y:0, r:0.14, n:5, s:0.8, a:0 });
  const pa  = g.add('sh.polar', 560, Y + 170, { n:6, a:0 });
  const ro  = g.add('sh.rotate',800, Y + 170, { a:0 });
  const sq  = g.add('sh.squeeze', 1030, Y + 170, { q:0.6, ax:'y', x:0, y:0 });
  const bl  = g.add('sh.blend', 1270, Y + 170, { k:0.08, mode:'union' });
  const ct  = g.add('sh.contour', 1510, Y + 170,
                    { lvl:0, wid:0.006, rings:4, sp:0.05, fall:0.5,
                      luma:0.85, warm:0.1, route:'scanned', blend:'add', res:'med' });
  g.connect(lp.id, 0, rr.id, 0);
  g.connect(rr.id, 0, st.id, 0);            // measured radius
  g.connect(st.id, 0, pa.id, 0);
  g.connect(pa.id, 0, ro.id, 0);
  g.connect(ro.id, 0, sq.id, 0);
  g.connect(sq.id, 0, bl.id, 0);
  g.connect(bl.id, 0, ct.id, 0);

  // the second shape for the blend to fuse with
  const rg  = g.add('sdf.ring', 1030, Y + 470, { x:0, y:0, r:0.3, th:0.05 });
  g.connect(rg.id, 0, bl.id, 1);

  // --- motion: a drawn ramp, looping, driving the rotation ----------------
  const rmp = g.add('gen.ramp', 560, Y + 470, { per:22, mode:'loop', amp:1, off:0 });
  g.connect(rmp.id, 0, ro.id, 1);

  // load also opens the squeeze, so the whole array tapers as the machine works
  const sqm = g.add('remap', 800, Y + 470, { il:0, ih:1, ol:0, oh:1.4, cl:'on' });
  g.connect(lp.id, 0, sqm.id, 0);
  g.connect(sqm.id, 0, sq.id, 1);

  // --- the colouriser -----------------------------------------------------
  // Band edge 1 slides down as the machine loads, so the cyan region swells
  // across the image under load. This replaces the two-colour legacy key.
  const ke  = g.add('remap',     1270, Y + 470, { il:0, ih:1, ol:0.42, oh:0.18, cl:'on' });
  const ky  = g.add('col.keyer', 1510, Y + 470, {});
  g.connect(lp.id, 0, ke.id, 0);
  g.connect(ke.id, 0, ky.id, 0);

  // --- drawing as computation: a hand-drawn FIR filter --------------------
  // The default drawing is an exponential decay, so out of the box this is a
  // smoother. Redraw it as a flat line for a boxcar, or put a bump at the
  // right-hand edge for an echo. The drawing is the coefficient vector.
  const dk  = g.add('channel',     60,  Y + 760, { ch: 'disk.tps' });
  const krn = g.add('draw.kernel', 300, Y + 760, { len:4, rate:20, norm:'unity', gain:1 });
  const ksc = g.add('scope',       600, Y + 760, { span:40 });
  g.connect(dk.id, 0, krn.id, 0);
  g.connect(krn.id, 0, ksc.id, 0);

  g.dirty = true;
  return g.nodes.size - before;
}

// ---------------------------------------------------------------- rd demo
// Wires the reaction-diffusion stage to the machine. Added alongside whatever
// is already on the canvas; the only existing sink it touches is rd.*, which
// nothing else writes.
//
//   cpu.busy_pct -> rd.mix        the chemistry fades IN as the machine works
//   cpu.busy_pct -> regime blend  coral when calm, toward mitosis under load
//   disk + net   -> rd.inject     i/o feeds the reaction harder
//
// So an idle machine shows scanlines, and a working one dissolves into
// branching growth. The crossfade is the point: you are not choosing between
// the two looks, the machine is.

export function rdDemo(g) {
  const before = g.nodes.size;
  const Y = 2900;

  const cpu = g.add('channel', 60,  Y, { ch: 'cpu.busy_pct' });
  const sc  = g.add('scale',   290, Y, { mul: 0.01, add: 0 });
  const lp  = g.add('lowpass', 500, Y, { cut: 0.6 });
  g.connect(cpu.id, 0, sc.id, 0);
  g.connect(sc.id, 0, lp.id, 0);

  // load fades the chemistry in over the scanlines
  const mx = g.add('remap', 720, Y, { il: 0.05, ih: 0.75, ol: 0, oh: 1, cl: 'on' });
  const mo = g.add('out',   950, Y, { dest: 'rd.mix', mode: 'set' });
  g.connect(lp.id, 0, mx.id, 0);
  g.connect(mx.id, 0, mo.id, 0);

  // and walks it across the (F, k) plane while it does
  const rg = g.add('rd.regime', 720, Y + 150, { a: 'coral', b: 'mitosis', t: 0 });
  const fo = g.add('out',       950, Y + 150, { dest: 'rd.feed', mode: 'set' });
  const ko = g.add('out',       950, Y + 260, { dest: 'rd.kill', mode: 'set' });
  g.connect(lp.id, 0, rg.id, 0);
  g.connect(rg.id, 0, fo.id, 0);
  g.connect(rg.id, 1, ko.id, 0);

  // i/o feeds the reaction: busy buses grow, idle ones starve
  const dk = g.add('channel', 60,  Y + 400, { ch: 'disk.tps' });
  const dn = g.add('norm',    290, Y + 400, { ref: 2500, track: 'on' });
  const ij = g.add('remap',   720, Y + 400, { il: 0, ih: 1, ol: 0.35, oh: 1.4, cl: 'on' });
  const io = g.add('out',     950, Y + 400, { dest: 'rd.inject', mode: 'set' });
  g.connect(dk.id, 0, dn.id, 0);
  g.connect(dn.id, 0, ij.id, 0);
  g.connect(ij.id, 0, io.id, 0);

  // fixed settings: 16 iterations a frame is plenty, decay 0 because
  // Gray-Scott already removes V at rate F+k
  const it = g.add('const', 720, Y + 530, { v: 16 });
  const io2= g.add('out',   950, Y + 530, { dest: 'rd.iters', mode: 'set' });
  g.connect(it.id, 0, io2.id, 0);

  g.dirty = true;
  return g.nodes.size - before;
}
