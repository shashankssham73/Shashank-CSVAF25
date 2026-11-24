const C = require('./core.js');
const D = require('./dsp.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const ctx0 = () => ({ t: 0, dt: 1 / 30, outs: {}, SPEC: D.SPEC });

// every op builds with defaults and evaluates without throwing
{
  const gr = C.newGraph();
  const shapes = ['polygon', 'star', 'lissa', 'spiral', 'blob', 'grid'];
  for (const op of Object.keys(C.OPS)) if (!C.OPS[op].single) C.addNode(gr, op);
  for (const s of shapes) for (const x of ['move', 'scale', 'rotate', 'mirror', 'repeat', 'warp', 'twist']) { /* wired below */ }
  const c = ctx0(); let err = null;
  try { C.Tele.step(0.03, 0); C.evaluate(gr, c); } catch (e) { err = e; }
  ok(!err, 'all ops evaluate unconnected' + (err ? ' ' + err.message : ''));
}

// every shape x every transformer gives finite points
{
  let bad = 0, cnt = 0;
  for (const sop of ['polygon', 'star', 'lissa', 'spiral', 'blob', 'grid']) for (const top of ['move', 'scale', 'rotate', 'mirror', 'repeat', 'warp', 'twist', 'morph']) {
    const gr = C.newGraph(); const s = C.addNode(gr, sop), t = C.addNode(gr, top);
    C.connect(gr, t.id, top === 'morph' ? 'a' : 'shape', s.id); if (top === 'morph') C.connect(gr, t.id, 'b', s.id);
    const o = C.evaluate(gr, ctx0())[t.id].out; cnt++;
    if (!o || !o.paths.length || o.paths.some((p) => p.p.length < 4 || p.p.some((x) => !Number.isFinite(x)))) { bad++; console.log('bad', sop, top); }
  }
  ok(bad === 0, `${cnt} shape x transformer combos give finite geometry`);
}

// math of specific ops
{
  const gr = C.newGraph(); const s = C.addNode(gr, 'polygon'); s.p.sides = 4; s.p.r = 1;
  const r = C.addNode(gr, 'rotate'); r.p.deg = 90; C.connect(gr, r.id, 'shape', s.id);
  const o = C.evaluate(gr, ctx0());
  const a = o[s.id].out.paths[0].p, b = o[r.id].out.paths[0].p;
  // square vertex 0 is (cos -90, sin -90) = (0,-1); rotated +90deg -> (1, 0)
  ok(Math.abs(a[0]) < 1e-9 && Math.abs(a[1] + 1) < 1e-9 && Math.abs(b[0] - 1) < 1e-9 && Math.abs(b[1]) < 1e-9, 'rotate 90 deg moves (0,-1) to (1,0)');
  const m = C.addNode(gr, 'mirror'); m.p.n = 4; C.connect(gr, m.id, 'shape', s.id);
  ok(C.evaluate(gr, ctx0())[m.id].out.paths.length === 4, 'mirror n=4 makes 4 copies');
  const rp = C.addNode(gr, 'repeat'); rp.p.count = 5; C.connect(gr, rp.id, 'shape', s.id);
  ok(C.evaluate(gr, ctx0())[rp.id].out.paths.length === 5, 'repeat 5 makes 5 copies');
  const w = C.addNode(gr, 'warp'); w.p.ampx = 0; w.p.ampy = 0; C.connect(gr, w.id, 'shape', s.id);
  const wp = C.evaluate(gr, ctx0())[w.id].out.paths[0].p;
  ok(wp.length > a.length * 5, 'warp densifies straight edges so they can bend (' + a.length / 2 + ' -> ' + wp.length / 2 + ' points)');
  w.p.ampx = 0.3; const wb = C.evaluate(gr, ctx0())[w.id].out.paths[0].p; let moved = 0; for (let i = 0; i < wb.length; i++) moved = Math.max(moved, Math.abs(wb[i] - wp[i])); ok(moved > 0.05, 'warp amplitude bends the shape, max move ' + moved.toFixed(3));
  // morph t=0 -> A, t=1 -> B
  const tri = C.addNode(gr, 'polygon'); tri.p.sides = 3; tri.p.r = 0.5;
  const mo = C.addNode(gr, 'morph'); C.connect(gr, mo.id, 'a', s.id); C.connect(gr, mo.id, 'b', tri.id);
  mo.p.t = 0; const m0 = C.evaluate(gr, ctx0())[mo.id].out.paths[0].p; mo.p.t = 1; const m1 = C.evaluate(gr, ctx0())[mo.id].out.paths[0].p;
  const rad = (p) => { let mx = 0; for (let i = 0; i < p.length; i += 2) mx = Math.max(mx, Math.hypot(p[i], p[i + 1])); return mx; };
  ok(Math.abs(rad(m0) - 1) < 0.02 && Math.abs(rad(m1) - 0.5) < 0.02, `morph endpoints: radius ${rad(m0).toFixed(2)} -> ${rad(m1).toFixed(2)}`);
}

// signal mapping + cycles read previous frame
{
  const gr = C.newGraph(); const l = C.addNode(gr, 'lfo'); l.p.off = 0.5; l.p.amp = 0;
  const rot = C.addNode(gr, 'rotate'); C.connect(gr, rot.id, 'deg', l.id);
  const c = ctx0(); C.evaluate(gr, c);
  ok(Math.abs(c.resolved[rot.id].deg - 0) < 1e-9, 'signal 0.5 maps to middle of -180..180 = 0 deg');
  l.p.off = 1; C.evaluate(gr, c); ok(Math.abs(c.resolved[rot.id].deg - 180) < 1e-9, 'signal 1.0 maps to 180 deg');
  // cycle: a = smooth(b), b = smooth(a); must not hang, must use last frame
  const s1 = C.addNode(gr, 'smooth'), s2 = C.addNode(gr, 'smooth'); s1.p.amt = 0; s2.p.amt = 0;
  C.connect(gr, s1.id, 'in', s2.id); C.connect(gr, s2.id, 'in', s1.id); s1.s.y = 0.2; s2.s.y = 0.8;
  const c2 = ctx0(); let t0 = Date.now(); for (let i = 0; i < 5; i++) C.evaluate(gr, c2);
  ok(Date.now() - t0 < 500, 'cycle evaluates (no infinite loop)');
}

// lfo is bounded; noise bounded; tele bounded; curve interpolates; spec gives numbers
{
  const gr = C.newGraph(); const l = C.addNode(gr, 'lfo'), n = C.addNode(gr, 'noise'), t = C.addNode(gr, 'tele'), cv = C.addNode(gr, 'curve'), sp = C.addNode(gr, 'spec');
  const c = ctx0(); let mn = 9, mx = -9;
  for (let i = 0; i < 3000; i++) { c.t = i / 30; C.Tele.step(1 / 30, c.t); const o = C.evaluate(gr, c); for (const [id, k] of [[l.id, 'out'], [n.id, 'out'], [t.id, 'out'], [cv.id, 'out'], [sp.id, 'low'], [sp.id, 'mid'], [sp.id, 'high']]) { const x = o[id][k]; mn = Math.min(mn, x); mx = Math.max(mx, x); if (!Number.isFinite(x)) fails++; } }
  ok(mn >= 0 && mx <= 1, `100 s of every source stays in 0..1 (min ${mn.toFixed(3)}, max ${mx.toFixed(3)})`);
  const o = C.evaluate(gr, Object.assign(ctx0(), { t: 0 }));
  cv.curve.fill(0); cv.curve[0] = 1; cv.curve[1] = 0.5; const c3 = ctx0(); c3.t = 0; ok(Math.abs(C.evaluate(gr, c3)[cv.id].out - 1) < 1e-9, 'drawn curve at phase 0 returns first sample');
}

// serialize round trip
{
  const gr = C.defaultGraph(); const s = C.serialize(gr); const g2 = C.deserialize(s);
  ok(Object.keys(g2.nodes).length === Object.keys(gr.nodes).length && JSON.stringify(g2.nodes.rotate1.in) === JSON.stringify(gr.nodes.rotate1.in), 'default graph survives serialize round trip (' + (s.length / 1024).toFixed(0) + ' KB)');
  const sp = C.addNode(gr, 'spec'); sp.grid[1234] = 99; const g3 = C.deserialize(C.serialize(gr)); ok(g3.nodes[sp.id].grid[1234] === 99, 'painted spectrogram survives round trip');
  const out = C.evaluate(C.defaultGraph(), ctx0()); ok(out.render !== undefined, 'default graph evaluates');
}

// palette LUT
{
  const lut = C.makeLUT(C.PRESETS.Tron, 0, 0, 1);
  ok(lut[0] === (((255 << 24) | (20 << 16) | (8 << 8) | 0) >>> 0), 'LUT[0] is first colour of Tron preset');
  const b = C.makeLUT(['#000000', '#ffffff'], 0, 4, 1); const lv = new Set(Array.from(b, (x) => x & 255));
  ok(lv.size === 4, 'steps=4 posterises into 4 levels, got ' + lv.size);
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
