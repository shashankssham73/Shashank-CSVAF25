// defaults.js — the patch the Psychedelic OS starts with.
//
// Deliberately gentle. The thesis in 04-FEEDBACK-AND-FORM.md is that a
// micro-dose is about TIMING, not intensity, and the platform agrees: clicks
// pass through the overlay to the real UI underneath, so the more the image is
// displaced the less the desktop can be used. The default therefore sits at
// the readable end and leaves the violent settings one scrub away.

import { Graph } from '../m0-telemetry/patch/graph.js';

export function defaultPsyche() {
  const g = new Graph();
  const X = { src: 60, mid: 300, lpf: 520, dst: 760 };

  // --- the machine's pulse ------------------------------------------------
  const cpu = g.add('channel', X.src, 60, { ch: 'cpu.busy_pct' });
  const sc  = g.add('scale',   X.mid, 60, { mul: 0.01, add: 0 });
  const lp  = g.add('lowpass', X.lpf, 60, { cut: 0.8 });
  g.connect(cpu.id, 0, sc.id, 0);
  g.connect(sc.id, 0, lp.id, 0);

  // --- breathing: a slow wave along every word ---------------------------
  // from=index means the phase restarts at each word, so the wave travels
  // along words rather than sweeping the whole screen at once.
  const amp = g.add('remap',    X.dst,       60, { il: 0, ih: 1, ol: 1.2, oh: 7, cl: 'on' });
  const wav = g.add('txt.wave', X.dst + 240, 200,
                    { amp: 2, f: 0.22, axis: 'y', shape: 'sine',
                      from: 'index', scale: 0.55, target: 'all' });
  g.connect(lp.id, 0, amp.id, 0);
  g.connect(amp.id, 0, wav.id, 0);

  // --- the effect arrives rather than happening everywhere ---------------
  // Sits ABOVE every other modulator on the canvas, because the stack applies
  // top to bottom and a cascade only delays what comes after it.
  const csc = g.add('txt.cascade', X.dst + 240, 60,
                    { d: 0.012, from: 'char', scale: 1, target: 'all' });

  // --- filenames get their own slower, larger motion ---------------------
  const nw = g.add('txt.wave', X.dst + 240, 350,
                   { amp: 3.5, f: 0.16, axis: 'y', shape: 'sine',
                     from: 'word', scale: 1.4, target: 'name' });

  // --- weight follows load, so the desktop THICKENS as the machine works --
  const wgt = g.add('remap',    X.dst,       470, { il: 0, ih: 1, ol: 0, oh: 1.1, cl: 'on' });
  const axe = g.add('txt.axes', X.dst + 240, 470,
                    { w: 0.2, d: 0, s: 0, f: 0, from: 'none', scale: 1, target: 'all' });
  g.connect(lp.id, 0, wgt.id, 0);
  g.connect(wgt.id, 0, axe.id, 0);

  // --- memory pressure is the one thing allowed to disturb the page ------
  // Pressure, not load: something going wrong should look different from
  // something merely being busy.
  const po  = g.add('channel',    X.src,       640, { ch: 'vm.pageouts_per_s' });
  const pn  = g.add('norm',       X.mid,       640, { ref: 900, track: 'off' });
  const pe  = g.add('envelope',   X.lpf,       640, { a: 90, r: 2600 });
  const pj  = g.add('remap',      X.dst,       640, { il: 0, ih: 1, ol: 0, oh: 2.2, cl: 'on' });
  const jit = g.add('txt.jitter', X.dst + 240, 640,
                    { amt: 0, rot: 7, rate: 9, seed: 3, target: 'all' });
  g.connect(po.id, 0, pn.id, 0);
  g.connect(pn.id, 0, pe.id, 0);
  g.connect(pe.id, 0, pj.id, 0);
  g.connect(pj.id, 0, jit.id, 0);

  return g;
}

// Everything off except the layout, for A/B-ing an effect against plain text.
export function sober() { return new Graph(); }
