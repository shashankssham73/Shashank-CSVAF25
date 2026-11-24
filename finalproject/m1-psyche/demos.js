// demos.js — a patch that shows what the typography family can do.

import { makeCurve } from '../m0-telemetry/patch/opkit.js';

// Added below whatever is already on the canvas. Remember that modulators
// apply top to bottom, so the y positions here are not cosmetic.
export function kineticDemo(g) {
  const before = g.nodes.size;
  const Y = 1000;
  const X = { src: 60, mid: 300, lpf: 520, dst: 760, mod: 1010 };

  // --- drivers -----------------------------------------------------------
  const cpu = g.add('channel', X.src, Y, { ch: 'cpu.busy_pct' });
  const sc  = g.add('scale',   X.mid, Y, { mul: 0.01, add: 0 });
  const lp  = g.add('lowpass', X.lpf, Y, { cut: 1.0 });
  g.connect(cpu.id, 0, sc.id, 0); g.connect(sc.id, 0, lp.id, 0);

  const io  = g.add('channel', X.src, Y + 150, { ch: 'disk.tps' });
  const ion = g.add('norm',    X.mid, Y + 150, { ref: 2500, track: 'on' });
  g.connect(io.id, 0, ion.id, 0);

  // --- 1. cascade sits at the top, so everything below it arrives in turn -
  g.add('txt.cascade', X.mod, Y - 120, { d: 0.02, from: 'char', scale: 1, target: 'all' });

  // --- 2. a wave along every word, amplitude from load -------------------
  const amp = g.add('remap',    X.dst, Y, { il: 0, ih: 1, ol: 2, oh: 16, cl: 'on' });
  const wav = g.add('txt.wave', X.mod, Y,
                    { amp: 4, f: 0.35, axis: 'y', shape: 'sine',
                      from: 'index', scale: 0.6, target: 'all' });
  g.connect(lp.id, 0, amp.id, 0); g.connect(amp.id, 0, wav.id, 0);

  // --- 3. filenames ride a drawn baseline --------------------------------
  // The curve IS the shape of the line. Redraw it and the names follow.
  g.add('txt.baseline', X.mod, Y + 150,
        { cv: makeCurve('hump'), amt: 18, sh: 0, span: 'line', target: 'name' });

  // --- 4. i/o thickens the type ------------------------------------------
  const wg = g.add('remap',    X.dst, Y + 320, { il: 0, ih: 1, ol: 0, oh: 1.6, cl: 'on' });
  const ax = g.add('txt.axes', X.mod, Y + 320,
                   { w: 0.3, d: 0, s: 0, f: 0, from: 'none', scale: 1, target: 'all' });
  g.connect(ion.id, 0, wg.id, 0); g.connect(wg.id, 0, ax.id, 0);

  // --- 5. memory pressure scatters the page ------------------------------
  // Pressure, not load: something going WRONG should not look like something
  // merely being busy.
  const po = g.add('channel',     X.src, Y + 490, { ch: 'vm.pageouts_per_s' });
  const pn = g.add('norm',        X.mid, Y + 490, { ref: 900, track: 'off' });
  const pe = g.add('envelope',    X.lpf, Y + 490, { a: 120, r: 3000 });
  const ps = g.add('remap',       X.dst, Y + 490, { il: 0, ih: 1, ol: 0, oh: 0.22, cl: 'on' });
  const sct= g.add('txt.scatter', X.mod, Y + 490,
                   { amt: 0, origin: 'word', px: 0.5, py: 0.5, swirl: 40, target: 'body' });
  g.connect(po.id, 0, pn.id, 0); g.connect(pn.id, 0, pe.id, 0);
  g.connect(pe.id, 0, ps.id, 0); g.connect(ps.id, 0, sct.id, 0);

  // --- 6. hue drifts with the clock, slowly ------------------------------
  const lfo = g.add('lfo',        X.dst, Y + 660, { f: 0.03, shape: 'sine', amp: 0.06, off: 0 });
  const colr= g.add('txt.colour', X.mod, Y + 660,
                    { c: '#d7e6f0', h: 0, a: 1, f: 0, from: 'char', scale: 0.08, target: 'all' });
  g.connect(lfo.id, 0, colr.id, 0);

  g.dirty = true;
  return g.nodes.size - before;
}

// The image chain, pointed at the desktop. Load fades the whole pipeline in
// over the crisp desktop, so an idle machine is perfectly usable and a busy
// one dissolves. That gradient IS the micro-dose: the readable desktop is one
// end of a continuous knob, not a separate mode.
export function imageDemo(g) {
  const before = g.nodes.size;
  const Y = 2000;
  const X = { src: 60, mid: 300, lpf: 520, map: 760, out: 1010 };

  const cpu = g.add('channel', X.src, Y, { ch: 'cpu.busy_pct' });
  const sc  = g.add('scale',   X.mid, Y, { mul: 0.01, add: 0 });
  const lp  = g.add('lowpass', X.lpf, Y, { cut: 0.5 });
  g.connect(cpu.id, 0, sc.id, 0); g.connect(sc.id, 0, lp.id, 0);

  // the master dose: nothing at idle, heavily processed under load
  const mx = g.add('remap', X.map, Y, { il: 0.08, ih: 0.70, ol: 0, oh: 0.9, cl: 'on' });
  const mo = g.add('out',   X.out, Y, { dest: 'chain.mix', mode: 'set' });
  g.connect(lp.id, 0, mx.id, 0); g.connect(mx.id, 0, mo.id, 0);

  // deflection and perspective grow with it
  const rows = [
    ['scan.amp',   14,   70,   Y + 150],
    ['scan.persp', 0.25, 0.55, Y + 260],
    ['fb.gain',    0.86, 0.95, Y + 370],
    ['fb.zoom',    1.0006, 1.0030, Y + 480],
  ];
  for (const [dest, lo, hi, y] of rows) {
    const r = g.add('remap', X.map, y, { il: 0, ih: 1, ol: lo, oh: hi, cl: 'on' });
    const o = g.add('out',   X.out, y, { dest, mode: 'set' });
    g.connect(lp.id, 0, r.id, 0);
    g.connect(r.id, 0, o.id, 0);
  }

  // i/o grows the chemistry on top, so disk work looks different from cpu work
  const io  = g.add('channel', X.src, Y + 630, { ch: 'disk.tps' });
  const ion = g.add('norm',    X.mid, Y + 630, { ref: 2500, track: 'on' });
  // il is high because `norm` log-compresses: a quiet 60 tps still reads as
  // 0.64 against a 2500 reference, so a low threshold would leave the
  // chemistry running on an idle machine.
  const rm  = g.add('remap',   X.map, Y + 630, { il: 0.72, ih: 1, ol: 0, oh: 0.75, cl: 'on' });
  const ro  = g.add('out',     X.out, Y + 630, { dest: 'rd.mix', mode: 'set' });
  const ri  = g.add('const',   X.map, Y + 740, { v: 14 });
  const rio = g.add('out',     X.out, Y + 740, { dest: 'rd.iters', mode: 'set' });
  g.connect(io.id, 0, ion.id, 0); g.connect(ion.id, 0, rm.id, 0);
  g.connect(rm.id, 0, ro.id, 0); g.connect(ri.id, 0, rio.id, 0);

  // a four-band keyer so the desktop stops being grey
  g.add('col.keyer', X.out, Y + 850, {});

  g.dirty = true;
  return g.nodes.size - before;
}

// Layout & orientation: the desktop's furniture under signal control.
// Windows breathe and tilt, folder icons drift and pull toward a ring as the
// machine loads, and memory pressure throws everything outward. Remember the
// stack runs top to bottom, so these y positions are load-bearing.
export function layoutDemo(g) {
  const before = g.nodes.size;
  const Y = 3200;
  const X = { src: 60, mid: 300, lpf: 520, map: 760, mod: 1010 };

  const cpu = g.add('channel', X.src, Y, { ch: 'cpu.busy_pct' });
  const sc  = g.add('scale',   X.mid, Y, { mul: 0.01, add: 0 });
  const lp  = g.add('lowpass', X.lpf, Y, { cut: 0.4 });
  g.connect(cpu.id, 0, sc.id, 0); g.connect(sc.id, 0, lp.id, 0);

  // 1. icons leave the grid and gather into a ring as load rises
  const rg = g.add('remap',    X.map, Y,       { il: 0.10, ih: 0.75, ol: 0, oh: 0.85, cl: 'on' });
  const ri = g.add('lay.ring', X.mod, Y,       { amt: 0, r: 0.33, a: 0, px: 0.5, py: 0.5, target: 'icon' });
  g.connect(lp.id, 0, rg.id, 0); g.connect(rg.id, 0, ri.id, 0);

  // 2. everything breathes, phase by screen position so it reads as a sweep
  const mv = g.add('lay.move', X.mod, Y + 170,
                   { amp: 10, f: 0.07, axis: 'y', shape: 'sine', from: 'y', scale: 6, target: 'all' });

  // 3. windows lean, the amount following load
  const tk = g.add('remap',    X.map, Y + 330, { il: 0, ih: 1, ol: 0.02, oh: 0.22, cl: 'on' });
  const tl = g.add('lay.tilt', X.mod, Y + 330, { kx: 0.05, ky: 0, f: 0.05, from: 'none', scale: 1, target: 'window' });
  g.connect(lp.id, 0, tk.id, 0); g.connect(tk.id, 0, tl.id, 0);

  // 4. a slow per-surface drift so nothing is ever perfectly still
  g.add('lay.drift', X.mod, Y + 490, { amt: 7, rot: 2.5, rate: 0.12, seed: 4, target: 'all' });

  // 5. icons turn as they travel
  const rt = g.add('lay.rotate', X.mod, Y + 650,
                   { a: 14, f: 0.05, mode: 'phase', from: 'index', scale: 1.1, target: 'icon' });

  // 6. memory pressure throws the whole desktop outward. Pressure, not load:
  //    something going wrong should not look like something being busy.
  const po = g.add('channel',     X.src, Y + 810, { ch: 'vm.pageouts_per_s' });
  const pn = g.add('norm',        X.mid, Y + 810, { ref: 900, track: 'off' });
  const pe = g.add('envelope',    X.lpf, Y + 810, { a: 140, r: 3200 });
  const pg = g.add('remap',       X.map, Y + 810, { il: 0.15, ih: 1, ol: 0, oh: -0.45, cl: 'on' });
  const gv = g.add('lay.gravity', X.mod, Y + 810,
                   { g: 0, px: 0.5, py: 0.5, falloff: 'linear', target: 'all' });
  g.connect(po.id, 0, pn.id, 0); g.connect(pn.id, 0, pe.id, 0);
  g.connect(pe.id, 0, pg.id, 0); g.connect(pg.id, 0, gv.id, 0);

  g.dirty = true;
  return g.nodes.size - before;
}

// Botanical: your filesystem as a tree. Switch the view's source to
// "my folders as a tree" to see it. Growth follows disk activity, the flowers
// open with cpu load, and memory pressure twists the whole thing.
export function botanicalDemo(g) {
  const before = g.nodes.size;
  const Y = 4000;
  const X = { src: 60, mid: 300, lpf: 520, map: 760, mod: 1010 };

  // --- the tree grows as the disk works ---------------------------------
  const io  = g.add('channel',  X.src, Y, { ch: 'disk.tps' });
  const ion = g.add('norm',     X.mid, Y, { ref: 2500, track: 'on' });
  const ios = g.add('lowpass',  X.lpf, Y, { cut: 0.25 });
  const gm  = g.add('remap',    X.map, Y, { il: 0.55, ih: 1, ol: 0.35, oh: 1, cl: 'on' });
  const gr  = g.add('bot.grow', X.mod, Y, { grow: 1, labelDepth: 2 });
  g.connect(io.id, 0, ion.id, 0); g.connect(ion.id, 0, ios.id, 0);
  g.connect(ios.id, 0, gm.id, 0); g.connect(gm.id, 0, gr.id, 0);

  // --- cpu opens the flowers --------------------------------------------
  const cpu = g.add('channel',   X.src, Y + 170, { ch: 'cpu.busy_pct' });
  const csc = g.add('scale',     X.mid, Y + 170, { mul: 0.01, add: 0 });
  const clp = g.add('lowpass',   X.lpf, Y + 170, { cut: 0.6 });
  const bm  = g.add('remap',     X.map, Y + 170, { il: 0, ih: 1, ol: 0.1, oh: 0.9, cl: 'on' });
  const fr  = g.add('bot.fruit', X.mod, Y + 170, { fSize: 3.2, fPetals: 5, fBloom: 0.2, fSpread: 18 });
  g.connect(cpu.id, 0, csc.id, 0); g.connect(csc.id, 0, clp.id, 0);
  g.connect(clp.id, 0, bm.id, 0);
  g.connect(bm.id, 0, fr.id, 1);                 // input 1 is bloom; 0 is size

  // --- memory pressure twists the tree -----------------------------------
  // Pressure, not load: something going wrong should not look like work.
  const po = g.add('channel',  X.src, Y + 340, { ch: 'vm.pageouts_per_s' });
  const pn = g.add('norm',     X.mid, Y + 340, { ref: 900, track: 'off' });
  const pe = g.add('envelope', X.lpf, Y + 340, { a: 200, r: 4000 });
  const tw = g.add('remap',    X.map, Y + 340, { il: 0.1, ih: 1, ol: 0, oh: 26, cl: 'on' });
  const tr = g.add('bot.tree', X.mod, Y + 340,
                   { angle: 95, lenBase: 0.21, lenFall: 0.84, thick: 1.9,
                     photo: 0.12, twist: 0, maxDepth: 5 });
  g.connect(po.id, 0, pn.id, 0); g.connect(pn.id, 0, pe.id, 0);
  g.connect(pe.id, 0, tw.id, 0); g.connect(tw.id, 0, tr.id, 3);   // -> twist

  // --- the folder names sway on their branches ---------------------------
  g.add('txt.wave', X.mod, Y + 520,
        { amp: 3, f: 0.18, axis: 'y', shape: 'sine', from: 'word', scale: 1.2, target: 'name' });

  // --- and the whole tree sways as one surface ---------------------------
  g.add('lay.move', X.mod, Y + 650,
        { amp: 5, f: 0.05, axis: 'x', shape: 'sine', from: 'none', scale: 1, target: 'window' });

  g.dirty = true;
  return g.nodes.size - before;
}
