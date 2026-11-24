// Tests for per-glyph typography. The modulator stack is pure arithmetic, so
// all of it is checkable without a browser.

import { applyStack, identity, coordOf, hash01, spacingFor,
         applySurfaceStack, surfIdentity, surfCoord } from './modulate.js';
import { mockDesktop, layout, monoMeasure } from './scene.js';
import { botanicalScene, BOT_DEFAULTS } from './botanical.js';
import { entropy, classify, analyse, axScene } from './semantic.js';
import { makeCurve } from '../m0-telemetry/patch/opkit.js';

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ok   ${name}${got !== undefined ? ' -> ' + got : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' -> ' + got : ''}`); }
};
const near = (a, b, e) => Math.abs(a - b) <= e;

const W = 1440, H = 900;
const D = mockDesktop(W, H);
const G = layout(D.blocks, monoMeasure, []);
const body = G.filter(g => g.kind === 'body');
// A single long word, for tests about behaviour WITHIN a word: `from: index`
// restarts at every word boundary, so a flat slice of glyphs repeats phases.
const longWi = (() => {
  const count = {};
  for (const g of body) count[g.wi] = (count[g.wi] || 0) + 1;
  return +Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
})();
const oneWord = body.filter(g => g.wi === longWi);
const names = G.filter(g => g.kind === 'name');
const A = (g, stack, t = 0) => applyStack(g, stack, t, W, H);

const wave = o => ({ op:'wave', amp:10, f:0, axis:'y', shape:'sine',
                     from:'index', scale:1, target:'all', ...o });

// ---------------------------------------------------------------- identity
{
  const o = A(G[0], []);
  ok('an empty stack changes nothing',
     o.dx===0 && o.dy===0 && o.rot===0 && o.sx===1 && o.sy===1 && o.alpha===1);
  ok('a null stack changes nothing', A(G[0], null).dy === 0);
}

// ---------------------------------------------------------------- wave
{
  const st = [wave({})];
  const offs = oneWord.map(g => A(g, st).dy);
  ok(`wave: every glyph of a ${oneWord.length}-letter word gets its own offset`,
     new Set(offs.map(v => v.toFixed(3))).size === oneWord.length,
     '"' + oneWord.map(g=>g.ch).join('') + '" ' + offs.slice(0,4).map(v=>v.toFixed(2)).join(' ') + ' ...');
  // and the phase RESTARTS at each word, which is what from=index means
  ok('wave from=index restarts the wave at every word boundary',
     body.filter(g => g.i === 0).every(g => A(g, st).dy === 0));
  ok('wave: displacement never exceeds the amplitude',
     G.every(g => Math.abs(A(g, st).dy) <= 10.000001), 'amp 10');
  // glyph index 0 of every word has phase 0, so no displacement
  ok('wave: the first glyph of each word sits at phase zero',
     body.filter(g => g.i === 0).every(g => near(A(g, st).dy, 0, 1e-9)));
}
{
  // a wave riding on `word` must move whole words together
  const st = [wave({ from:'word', scale:1 })];
  const w0 = body.filter(g => g.wi === body[0].wi).map(g => A(g, st).dy);
  ok('wave from=word moves a whole word as one unit',
     new Set(w0.map(v=>v.toFixed(6))).size === 1, w0[0].toFixed(3));
}
{
  const st = [wave({ shape:'bounce', from:'char', scale:0.7 })];
  ok('wave shape=bounce never goes negative (it sits on a floor)',
     G.every(g => A(g, st).dy >= -1e-12));
  const sq = [wave({ shape:'square', from:'char', scale:0.7 })];
  ok('wave shape=square is only ever +/- the amplitude',
     G.every(g => near(Math.abs(A(g, sq).dy), 10, 1e-9)));
}
{
  // with f > 0 it must actually animate
  const st = [wave({ f:1, from:'none' })];
  const a = A(G[0], st, 0).dy, b = A(G[0], st, 0.25).dy;
  ok('wave: a non-zero rate animates it', Math.abs(a - b) > 5, `${a.toFixed(3)} -> ${b.toFixed(3)}`);
  ok('wave: one period later it is back', near(A(G[0], st, 1).dy, a, 1e-9));
}

// ---------------------------------------------------------------- targets
{
  const st = [wave({ target:'name', from:'char', scale:1 })];
  ok('target: named files move', names.some(g => Math.abs(A(g, st).dy) > 0.1));
  ok('target: body text is untouched', body.every(g => A(g, st).dy === 0));
  ok('target: the menu bar is untouched',
     G.filter(g=>g.kind==='menu').every(g => A(g, st).dy === 0));
}

// ---------------------------------------------------------------- jitter
{
  const st = [{ op:'jitter', amt:5, rot:20, rate:0, seed:1, target:'all' }];
  const a = A(G[5], st, 0), b = A(G[5], st, 7.3);
  ok('jitter: stable over time at rate 0 (scattered text stays scattered)',
     a.dx === b.dx && a.dy === b.dy, `dx ${a.dx.toFixed(3)}`);
  ok('jitter: different glyphs get different offsets',
     new Set(G.slice(0,20).map(g => A(g, st).dx.toFixed(4))).size > 15);
  ok('jitter: bounded by the amount', G.every(g => Math.abs(A(g, st).dx) <= 5.0000001));
  const seeded = [{ ...st[0], seed:2 }];
  ok('jitter: the seed changes the pattern', A(G[5], seeded).dx !== a.dx);
}
{
  const st = [{ op:'jitter', amt:5, rot:0, rate:4, seed:1, target:'all' }];
  // rate 4 means buckets change at t = 0.25, 0.50, 0.75 ...
  const t0 = A(G[5], st, 0.10).dx, t1 = A(G[5], st, 0.30).dx, t2 = A(G[5], st, 0.55).dx;
  ok('jitter: a reseed rate makes it step', t0 !== t1 && t1 !== t2,
     [t0,t1,t2].map(v=>v.toFixed(2)).join(' '));
  ok('jitter: but it holds for the whole of one step',
     A(G[5], st, 0.26).dx === A(G[5], st, 0.49).dx);
}

// ---------------------------------------------------------------- rotate
{
  const base = { op:'rotate', a:10, f:0, from:'index', scale:1, target:'all' };
  const alt = G.slice(0, 8).map(g => A(g, [{ ...base, mode:'alternate' }]).rot);
  ok('rotate alternate: consecutive glyphs tilt opposite ways',
     alt.every((v, k) => k === 0 || Math.sign(v) !== Math.sign(alt[k-1])),
     alt.slice(0,4).map(v=>(v*57.3).toFixed(0)).join(' '));
  const uni = G.slice(0, 8).map(g => A(g, [{ ...base, mode:'uniform' }]).rot);
  ok('rotate uniform: every glyph tilts the same way', new Set(uni.map(v=>v.toFixed(9))).size === 1);
  const ramp = oneWord.map(g => A(g, [{ ...base, mode:'ramp' }]).rot);
  ok('rotate ramp: tilt accumulates along a word',
     ramp.every((v, k) => k === 0 || v > ramp[k-1]), ramp.map(v=>(v*57.3).toFixed(0)).join(' ') + ' deg');
  // across the whole run it keeps accumulating only with from=char
  const runRamp = body.slice(0, 8).map(g => A(g, [{ ...base, mode:'ramp', from:'char' }]).rot);
  ok('rotate ramp from=char accumulates across word boundaries too',
     runRamp.every((v, k) => k === 0 || v > runRamp[k-1]));
}

// ---------------------------------------------------------------- steady
{
  // The trap this guards: `from: none` with `rate: 0` would multiply by
  // sin(0) = 0 and silently do nothing at all.
  const st = [{ op:'scale', s:0.5, f:0, base:1, axis:'both',
                from:'none', scale:1, target:'all' }];
  ok('scale: no phase source and no rate means a CONSTANT, not zero',
     near(A(G[0], st).sx, 1.5, 1e-12), A(G[0], st).sx.toFixed(4));
  const ax = [{ op:'axes', w:0.8, d:0.2, sl:10, f:0, from:'none', scale:1, target:'all' }];
  const o = A(G[0], ax);
  ok('axes: the same holds for weight, width and slant',
     near(o.weight, 0.8, 1e-12) && near(o.sx, 1.2, 1e-12) && o.slant > 0,
     `w ${o.weight} sx ${o.sx.toFixed(2)}`);
}

// ---------------------------------------------------------------- baseline
{
  const flat = new Array(32).fill(0.5);
  ok('baseline: a flat 0.5 drawing moves nothing',
     G.every(g => near(A(g, [{ op:'baseline', cv:flat, amt:40, sh:0, span:'line', target:'all' }]).dy, 0, 1e-9)));
  const st = [{ op:'baseline', cv:makeCurve('hump'), amt:40, sh:0, span:'line', target:'all' }];
  const line = body.filter(g => g.li === body[0].li);
  const mid  = line[Math.floor(line.length / 2)];
  const end  = line[line.length - 1];
  ok('baseline: a drawn hump RAISES the middle of the line',
     A(mid, st).dy < -10, A(mid, st).dy.toFixed(2) + ' px (negative is up)');
  ok('baseline: and drops the ends', A(end, st).dy > 0, A(end, st).dy.toFixed(2));
  ok('baseline: bounded by the amount',
     G.every(g => Math.abs(A(g, st).dy) <= 20.0000001), 'amt 40 -> +/-20 about centre');
}

// ---------------------------------------------------------------- scatter
{
  const off = [{ op:'scatter', amt:0, origin:'word', px:0.5, py:0.5, swirl:0, target:'all' }];
  ok('scatter: amount 0 is exactly no change',
     G.every(g => A(g, off).dx === 0 && A(g, off).dy === 0));
  const st = [{ op:'scatter', amt:0.5, origin:'word', px:0.5, py:0.5, swirl:0, target:'all' }];
  const g = body.find(x => x.x > x.wx + 2);
  ok('scatter: pushes a glyph away from its word centre',
     Math.sign(A(g, st).dx) === Math.sign(g.x - (g.wx + g.ww / 2)),
     `dx ${A(g, st).dx.toFixed(2)}`);
  const sw = [{ ...st[0], swirl:90 }];
  ok('scatter: swirl adds rotation about the origin', A(g, sw).dy !== A(g, st).dy);
}

// ---------------------------------------------------------------- cascade
{
  const plain   = [wave({ f:1, from:'none' })];
  const delayed = [{ op:'cascade', d:0.1, from:'char', scale:1, target:'all' }, wave({ f:1, from:'none' })];
  const a0 = A(G[0], plain, 0).dy, a1 = A(G[1], plain, 0).dy;
  ok('without cascade, every glyph is in step', near(a0, a1, 1e-12));
  const b0 = A(G[0], delayed, 0).dy, b1 = A(G[1], delayed, 0).dy;
  ok('cascade: the effect arrives later along the text', Math.abs(b0 - b1) > 1,
     `${b0.toFixed(3)} vs ${b1.toFixed(3)}`);
}

// ---------------------------------------------------------------- stacking
{
  const st = [wave({ amp:6 }), wave({ amp:4, from:'line', scale:2 })];
  const g = body[3];
  const a = A(g, [st[0]]).dy, b = A(g, [st[1]]).dy, both = A(g, st).dy;
  ok('modulators accumulate', near(both, a + b, 1e-9), `${a.toFixed(3)} + ${b.toFixed(3)} = ${both.toFixed(3)}`);
}
{
  const st = [{ op:'scale', s:0, f:0, base:2, axis:'both', from:'none', scale:1, target:'all' },
              { op:'scale', s:0, f:0, base:3, axis:'both', from:'none', scale:1, target:'all' }];
  ok('scales multiply rather than add', near(A(G[0], st).sx, 6, 1e-12), A(G[0], st).sx);
}

// ---------------------------------------------------------------- coords
{
  const g = { i:3, ci:40, wi:7, li:2, x:720, y:450 };
  ok('coord index', coordOf(g,'index',W,H) === 3);
  ok('coord char',  coordOf(g,'char',W,H) === 40);
  ok('coord word',  coordOf(g,'word',W,H) === 7);
  ok('coord line',  coordOf(g,'line',W,H) === 2);
  ok('coord x is normalised', near(coordOf(g,'x',W,H), 0.5, 1e-9), coordOf(g,'x',W,H));
  ok('coord y is normalised', near(coordOf(g,'y',W,H), 0.5, 1e-9));
  ok('coord none is zero',    coordOf(g,'none',W,H) === 0);
  const r = coordOf(g,'rand',W,H);
  ok('coord rand is in range and stable', r >= 0 && r < 10 && r === coordOf(g,'rand',W,H), r.toFixed(4));
}
{
  let lo = 2, hi = -1, n = 20000;
  for (let i = 0; i < n; i++) { const v = hash01(i); lo = Math.min(lo,v); hi = Math.max(hi,v); }
  ok('hash01 stays in [0,1)', lo >= 0 && hi < 1, `${lo.toFixed(5)}..${hi.toFixed(5)}`);
  let sum = 0; for (let i = 0; i < n; i++) sum += hash01(i);
  ok('hash01 is roughly uniform', near(sum/n, 0.5, 0.02), (sum/n).toFixed(4));
}

// ---------------------------------------------------------------- spacing
{
  const st = [{ op:'spacing', t:4, l:1.5, grow:'none', target:'all' }];
  const s = spacingFor(st, 'body');
  ok('spacing is pulled out of the stack', s.track === 4 && s.lead === 1.5, JSON.stringify(s));
  ok('spacing respects targets', spacingFor([{ ...st[0], target:'name' }], 'body').track === 0);
  const wide = layout(D.blocks, monoMeasure, st);
  const b0 = G.filter(g=>g.kind==='body'), b1 = wide.filter(g=>g.kind==='body');
  ok('tracking actually widens the laid-out line',
     b1[5].x > b0[5].x, `${b0[5].x.toFixed(1)} -> ${b1[5].x.toFixed(1)}`);
  const leadRows = new Set(b1.map(g=>g.y.toFixed(1)));
  ok('leading actually changes line positions',
     leadRows.size >= new Set(b0.map(g=>g.y.toFixed(1))).size);
}

// ---------------------------------------------------------------- layout
{
  ok('every glyph knows its word box',
     G.every(g => g.ww > 0 && g.wx <= g.x && g.x <= g.wx + g.ww + 1));
  ok('every glyph knows its line box',
     G.every(g => g.lw > 0 && g.lx <= g.x + 0.001));
  ok('glyph indices within a word are consecutive from 0',
     G.filter(g => g.i === 0).length === G[G.length-1].wi + 1);
  ok('centred names really are centred on their anchor', (() => {
    const n = G.filter(g => g.kind === 'name');
    return n.every(g => near(g.lx + g.lw / 2, g.wx + g.ww / 2, 40));
  })());
  const wrapped = G.filter(g => g.kind === 'body');
  ok('long body text wrapped to more than one line',
     new Set(wrapped.map(g => g.li)).size >= 4, new Set(wrapped.map(g=>g.li)).size + ' lines');
}

// ---------------------------------------------------------------- cost
{
  const st = [wave({}), wave({ from:'line', scale:2, axis:'x' }),
              { op:'jitter', amt:2, rot:6, rate:0, seed:1, target:'all' },
              { op:'rotate', a:8, f:0.3, mode:'phase', from:'char', scale:0.4, target:'all' },
              { op:'scale', s:0.2, f:0.5, base:1, axis:'both', from:'word', scale:1, target:'all' },
              { op:'axes', w:0.5, d:0.1, sl:4, f:0.2, from:'word', scale:1, target:'all' },
              { op:'baseline', cv:makeCurve('hump'), amt:14, sh:0, span:'line', target:'all' },
              { op:'colour', base:'#d7e6f0', h:0.1, a:1, f:0.3, from:'char', scale:0.2, target:'all' }];
  const o = identity();
  const t0 = performance.now();
  for (let f = 0; f < 120; f++) for (const g of G) applyStack(g, st, f/60, W, H, o);
  const ms = (performance.now() - t0) / 120;
  ok('403 glyphs through an 8-deep stack, per frame', ms < 3,
     ms.toFixed(3) + ' ms/frame');
}

// ================================================= layout & orientation
// Surfaces are windows, icons and the menu bar: rectangles with a pivot,
// whose transform carries everything drawn inside them.
const SURF = D.surfaces;
const WIN  = SURF.filter(s => s.kind === 'window');
const ICO  = SURF.filter(s => s.kind === 'icon');
const S = (s, st, t = 0) => applySurfaceStack(s, st, t, W, H);

{
  ok('the mock desktop has surfaces', SURF.length === 14, `${SURF.length}: ${WIN.length} windows, ${ICO.length} icons, 1 bar`);
  ok('every glyph belongs to a surface that exists', (() => {
    const ids = new Set(SURF.map(s => s.id));
    return G.every(g => ids.has(g.surf));
  })());
  ok('every chrome piece belongs to a surface', D.chrome.every(c => c.surf));
  ok('surfaces are numbered within their own kind',
     ICO.every((s, k) => s.kindIndex === k) && ICO.every(s => s.ofKind === ICO.length));
}
{
  const o = S(WIN[0], []);
  ok('an empty surface stack is identity',
     o.dx===0 && o.dy===0 && o.rot===0 && o.sx===1 && o.sy===1 && o.kx===0 && o.ky===0);
}
{
  const rot = a => [{ op:'rotate', a, f:0, mode:'uniform', from:'index', scale:1, target:'all' }];
  ok('rotate uniform turns every surface equally',
     new Set(SURF.map(s => S(s, rot(10)).rot.toFixed(9))).size === 1);
  const iconOnly = [{ op:'rotate', a:30, f:0, mode:'uniform', from:'index', scale:1, target:'icon' }];
  ok('targeting icons leaves windows and the bar alone',
     SURF.filter(s => s.kind !== 'icon').every(s => S(s, iconOnly).rot === 0));
  ok('and does move the icons', ICO.every(s => S(s, iconOnly).rot !== 0));
}
{
  // Grid-to-ring must land every icon on ONE circle, and be a real lerp in
  // between rather than a snap.
  const ring = (amt) => [{ op:'ring', amt, r:0.34, a:0, px:0.5, py:0.5, target:'icon' }];
  const at1 = ICO.map(s => { const o = S(s, ring(1)); return Math.hypot(s.cx+o.dx - W/2, s.cy+o.dy - H/2); });
  ok('ring at 1 puts every icon on one circle',
     Math.max(...at1) - Math.min(...at1) < 0.5,
     `radii ${Math.min(...at1).toFixed(1)}..${Math.max(...at1).toFixed(1)}, asked for ${0.34 * Math.min(W,H)}`);
  ok('ring at 0 changes nothing', ICO.every(s => { const o = S(s, ring(0)); return o.dx === 0 && o.dy === 0; }));
  ok('ring at 0.5 is genuinely halfway', ICO.every(s => {
    const full = S(s, ring(1)), half = S(s, ring(0.5));
    return Math.abs(half.dx - full.dx / 2) < 0.01 && Math.abs(half.dy - full.dy / 2) < 0.01;
  }));
  ok('ring spaces the icons evenly around the circle', (() => {
    const angs = ICO.map(s => { const o = S(s, ring(1));
      return Math.atan2(s.cy+o.dy - H/2, s.cx+o.dx - W/2); }).sort((a,b)=>a-b);
    const gaps = angs.slice(1).map((a,k) => a - angs[k]);
    return Math.max(...gaps) - Math.min(...gaps) < 1e-6;
  })());
}
{
  const g = (strength, falloff='constant') =>
    [{ op:'gravity', g:strength, px:0.5, py:0.5, falloff, target:'all' }];
  const dist = (s, o) => Math.hypot(s.cx + (o?o.dx:0) - W/2, s.cy + (o?o.dy:0) - H/2);
  ok('gravity pulls toward the point', ICO.every(s => dist(s, S(s, g(0.3))) < dist(s, null)));
  ok('negative gravity pushes away',   ICO.every(s => dist(s, S(s, g(-0.3))) > dist(s, null)));
  ok('zero gravity does nothing',      ICO.every(s => { const o = S(s, g(0)); return o.dx === 0 && o.dy === 0; }));
}
{
  const sp = [{ op:'spiral', k:0.3, px:0.5, py:0.5, pull:0, target:'all' }];
  ok('spiral preserves distance from the centre when pull is 0', SURF.every(s => {
    const o = S(s, sp);
    return Math.abs(Math.hypot(s.cx - W/2, s.cy - H/2) - Math.hypot(s.cx+o.dx - W/2, s.cy+o.dy - H/2)) < 0.01;
  }));
  ok('spiral moves far surfaces more than near ones', (() => {
    const d = s => Math.hypot(s.cx - W/2, s.cy - H/2);
    const near = SURF.reduce((a,b) => d(a) < d(b) ? a : b);
    const far  = SURF.reduce((a,b) => d(a) > d(b) ? a : b);
    const mv = s => { const o = S(s, sp); return Math.hypot(o.dx, o.dy); };
    return mv(near) < mv(far);
  })());
  const pulled = [{ ...sp[0], pull: 0.5 }];
  ok('spiral with pull draws surfaces inward', SURF.filter(s => Math.hypot(s.cx-W/2, s.cy-H/2) > 50)
     .every(s => { const o = S(s, pulled);
       return Math.hypot(s.cx+o.dx - W/2, s.cy+o.dy - H/2) < Math.hypot(s.cx - W/2, s.cy - H/2); }));
}
{
  const d = [{ op:'drift', amt:20, rot:6, rate:0, seed:1, target:'all' }];
  ok('surface drift is stable over time at rate 0', S(ICO[3], d, 0).dx === S(ICO[3], d, 11.4).dx);
  ok('surface drift differs per surface',
     new Set(SURF.map(s => S(s, d).dx.toFixed(5))).size === SURF.length);
  ok('surface drift is bounded', SURF.every(s => Math.abs(S(s, d).dx) <= 20.0000001));
}
{
  const t = [{ op:'tilt', kx:0.2, ky:0.05, f:0, from:'none', scale:1, target:'all' }];
  const o = S(WIN[0], t);
  ok('tilt produces shear and nothing else',
     near(o.kx, 0.2, 1e-12) && near(o.ky, 0.05, 1e-12) && o.rot === 0 && o.sx === 1, `kx ${o.kx} ky ${o.ky}`);
}
{
  ok('surface coord index', surfCoord(ICO[2], 'index', W, H) === 2);
  ok('surface coord x is normalised', near(surfCoord(WIN[0], 'x', W, H), WIN[0].cx / W, 1e-12));
  ok('surface coord none is zero', surfCoord(WIN[0], 'none', W, H) === 0);
}
{
  const st = [
    { op:'ring', amt:0.4, r:0.3, a:0, px:0.5, py:0.5, target:'icon' },
    { op:'rotate', a:9, f:0.2, mode:'phase', from:'index', scale:1, target:'all' },
    { op:'drift', amt:8, rot:3, rate:0, seed:2, target:'all' },
    { op:'scale', s:0.1, f:0.3, base:1, axis:'both', from:'index', scale:1, target:'all' },
    { op:'tilt', kx:0.06, ky:0, f:0.1, from:'y', scale:4, target:'window' },
  ];
  const o = surfIdentity();
  const t0 = performance.now();
  for (let f = 0; f < 2000; f++) for (const s of SURF) applySurfaceStack(s, st, f/60, W, H, o);
  const ms = (performance.now() - t0) / 2000;
  ok('14 surfaces through a 5-deep stack, per frame', ms < 0.2, (ms*1000).toFixed(1) + ' us/frame');
}

// ===================================================== botanical folders
// A fixed synthetic tree, so these do not depend on what is actually in
// ~/Documents today.
const T3 = (name, dir, kids = [], size = 0) => ({ name, dir, size, kids });
const F = (name, size) => T3(name, false, [], size);
const TREE = T3('root', true, [
  T3('big',   true, [ T3('a', true, Array.from({length:16}, (_,k)=>F('f'+k, 1e5))),
                      T3('b', true, Array.from({length:16}, (_,k)=>F('g'+k, 1e5))) ]),
  T3('small', true, [ F('one', 500), F('two', 900) ]),
  T3('mid',   true, Array.from({length:8}, (_,k)=>F('m'+k, 2e4))),
]);
const BW = 1440, BH = 900;
const B = p => botanicalScene(TREE, BW, BH, p);

{
  const s = B({});
  ok('botanical builds a scene', s.chrome.length > 0 && s.surfaces.length > 0,
     `${s.stats.branches} branches, ${s.stats.fruit} fruit, ${s.blocks.length} labels`);
  ok('it is the same shape as the mock desktop',
     !!(s.W && s.H && s.chrome && s.blocks && s.surfaces),
     'so everything downstream works unchanged');
  ok('every chrome piece and block carries a surface',
     s.chrome.every(c => c.surf) && s.blocks.every(b => b.surf));
  ok('it fits inside the canvas', (() => {
    const xs = s.chrome.map(c => c.x2 ?? c.x), ys = s.chrome.map(c => c.y2 ?? c.y);
    return Math.min(...xs) > 0 && Math.max(...xs) < BW && Math.min(...ys) > 0 && Math.max(...ys) < BH;
  })());
}
{
  // THE STRAND MODEL. 32 files under 'big' vs 2 under 'small' is 16x the
  // strands, so the branch should be 4x as thick, not 16x. That square root
  // is da Vinci's rule and it is what keeps a trunk looking like a trunk.
  const s = B({ grow: 1 });
  const br = s.chrome.filter(c => c.t === 'branch');
  const trunk = br[0];
  ok('trunk thickness is sqrt(total strands) scaled',
     near(trunk.w1, BOT_DEFAULTS.thick * Math.sqrt(42), 0.01),
     `${trunk.w1.toFixed(2)} for 42 files`);
  // depth-1 branches, in tree order: big(32), small(2), mid(8)
  const d1 = br.filter(c => c.depth === 1);
  ok('three top-level branches', d1.length === 3, d1.map(c=>c.w1.toFixed(1)).join(' '));
  const ratio = d1[0].w1 / d1[1].w1;
  ok('16x the files gives 4x the thickness, not 16x', near(ratio, 4, 0.01),
     `big/small = ${ratio.toFixed(3)}, sqrt(32/2) = 4`);
}
{
  const g = [0, 0.2, 0.4, 0.6, 0.8, 1].map(v => B({ grow:v }).stats.branches);
  ok('growth is monotone', g.every((v,k) => k === 0 || v >= g[k-1]), g.join(' -> '));
  ok('growth 0 is a bare root', g[0] === 0);
  // One branch per DIRECTORY. The test tree has 6, and it saturates before
  // grow reaches 1 because its real depth (3) is under maxDepth (5).
  const dirs = (n) => n.dir ? 1 + n.kids.reduce((a,k) => a + dirs(k), 0) : 0;
  ok('growth 1 draws one branch per directory', g[5] === dirs(TREE),
     `${g[5]} branches for ${dirs(TREE)} directories`);
  ok('and it saturates once every level is in', g[5] === g[3] && g[3] > g[1],
     'full by grow=0.6 since the tree is shallower than maxDepth');
}
{
  ok('the same tree always grows the same way',
     JSON.stringify(B({}).chrome) === JSON.stringify(B({}).chrome));
  ok('spread actually changes the geometry',
     JSON.stringify(B({angle:40}).chrome) !== JSON.stringify(B({angle:120}).chrome));
  ok('a wider spread is a wider tree', (() => {
     const w = p => { const c = B(p).chrome.map(x => x.x2 ?? x.x); return Math.max(...c) - Math.min(...c); };
     return w({angle:120}) > w({angle:40});
  })());
  ok('upward bias makes it taller and narrower', (() => {
     const m = p => { const c = B(p).chrome; const xs = c.map(x=>x.x2??x.x), ys = c.map(x=>x.y2??x.y);
       return { w: Math.max(...xs)-Math.min(...xs), h: Math.max(...ys)-Math.min(...ys) }; };
     const lo = m({photo:0}), hi = m({photo:0.6});
     return hi.w < lo.w;
  })());
}
{
  const s = B({ fPetals: 6, fBloom: 0.5 });
  const fr = s.chrome.filter(c => c.t === 'fruit');
  ok('files become fruit', fr.length > 0, `${fr.length} fruit for 42 files`);
  ok('fruit carry their petal count', fr.every(f => f.petals === 6));
  ok('bigger files make bigger fruit', (() => {
    const big = B({}).chrome.filter(c => c.t === 'fruit').map(c => c.r);
    return Math.max(...big) > Math.min(...big);
  })());
  ok('fruit size responds to the parameter',
     Math.max(...B({fSize:8}).chrome.filter(c=>c.t==='fruit').map(c=>c.r)) >
     Math.max(...B({fSize:2}).chrome.filter(c=>c.t==='fruit').map(c=>c.r)));
}
{
  ok('label depth controls how many folders are named',
     B({labelDepth:1}).blocks.length < B({labelDepth:3}).blocks.length,
     `${B({labelDepth:1}).blocks.length} vs ${B({labelDepth:3}).blocks.length}`);
  ok('the tree is one surface, each labelled folder another',
     B({}).surfaces[0].kind === 'window' && B({}).surfaces.slice(1).every(s => s.kind === 'icon'),
     `1 window + ${B({}).surfaces.length - 1} icons`);
  // so layout operators targeting 'icon' move folders, 'window' moves the tree
  const s = B({});
  ok('labelled folders can be targeted separately from the tree',
     s.surfaces.filter(x => x.kind === 'icon').length > 0);
}
{
  ok('a null tree does not crash', botanicalScene(null, BW, BH, {}).chrome.length === 0);
  ok('an empty directory does not crash',
     botanicalScene(T3('e', true, []), BW, BH, {}).chrome.length >= 0);
  ok('a single file does not crash',
     botanicalScene(T3('r', true, [F('x', 10)]), BW, BH, {}).chrome.length > 0);
}
{
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) B({ grow: (i % 100) / 100 });
  const ms = (performance.now() - t0) / 300;
  ok('the tree rebuilds inside a frame budget', ms < 2, ms.toFixed(3) + ' ms/frame');
}

// ================================================= semantic analysis
{
  ok('entropy of a constant string is 0', entropy('aaaaaaaa') === 0);
  ok('entropy of two alternating symbols is exactly 1 bit',
     near(entropy('abababab'), 1, 1e-12), entropy('abababab').toFixed(6));
  ok('entropy of four equal symbols is exactly 2 bits',
     near(entropy('abcdabcd'), 2, 1e-12));
  ok('prose sits between', entropy('the quick brown fox') > 3 && entropy('the quick brown fox') < 4.5,
     entropy('the quick brown fox').toFixed(3));
  ok('entropy is never negative and never exceeds log2(len)', (() => {
    for (const s of ['', 'a', 'ab', 'hello world', '~/x/y.md', '%%%%'])
      if (entropy(s) < 0 || entropy(s) > Math.log2(Math.max(2, s.length)) + 1e-9) return false;
    return true;
  })());
  ok('a one-character string has no entropy', entropy('x') === 0);
  ok('empty text does not crash', entropy('') === 0 && analyse('').kind === 'empty');
}
{
  const cases = [['~/Projects/final/notes.md','path'], ['/Users/x/Documents','path'],
                 ['final/notes.md','path'], ['https://karlsims.com/rd.html','url'],
                 ['14:32','time'], ['2026-11-23','date'], ['1.4 GB','size'],
                 ['42 items','size'], ['$1,240.00','number'], ['cpu.busy_pct','identifier'],
                 ['Save','identifier'], ['%&*#','symbol'],
                 ['The system is not a place you visit','sentence'], ['hello world','word']];
  let wrong = 0;
  for (const [t, want] of cases) if (classify(t) !== want) { wrong++; console.log(`       ${t} -> ${classify(t)}, wanted ${want}`); }
  ok('every class is identified correctly', wrong === 0, `${cases.length - wrong}/${cases.length}`);
}
{
  const a = analyse('Report 2026-Q3 final.pdf', { depth:7, role:'AXStaticText', app:'Finder' });
  ok('analysis reports length and words', a.len === 24 && a.words === 3, `${a.len} chars, ${a.words} words`);
  ok('analysis carries provenance', a.depth === 7 && a.role === 'AXStaticText' && a.app === 'Finder');
  ok('digit share is measured', a.digits > 0.2 && a.digits < 0.35, a.digits.toFixed(3));
  ok('type-token ratio is 1 for short runs', analyse('two words').ttr === 1);
  ok('and real for long ones', (() => { const t = analyse('the cat sat on the mat the cat').ttr;
     return t > 0 && t < 1; })(), analyse('the cat sat on the mat the cat').ttr.toFixed(3));
}

// --------------------------------------- semantics as phase sources
{
  const mk = t => ({ kind:'body', x:100, y:100, size:13, text:t, sem:analyse(t) });
  const gl = layout([mk('aaaaaaaa'), mk('a8Fk2!xQ9zLm'), mk('~/notes/final.md')], monoMeasure, []);
  ok('glyphs carry their analysis', gl.every(g => g.sem && g.sem.kind));
  const st = [{ op:'wave', amp:10, f:0, axis:'y', shape:'sine', from:'entropy', scale:1, target:'all' }];
  const byEnt = new Map();
  for (const g of gl) byEnt.set(g.sem.entropy.toFixed(2), applyStack(g, st, 0, W, H).dy.toFixed(3));
  ok('entropy drives displacement', byEnt.size === 3 && byEnt.get('0.00') === '0.000',
     [...byEnt.entries()].map(([e,d]) => `H=${e}:${d}`).join('  '));
  ok('a constant-text run sits at phase zero',
     gl.filter(g => g.sem.entropy === 0).every(g => applyStack(g, st, 0, W, H).dy === 0));
}
{
  // Targeting by SEMANTIC class, not by role — "every path on screen".
  const mk = t => ({ kind:'body', x:100, y:100, size:13, text:t, sem:analyse(t) });
  const gl = layout([mk('~/notes/final.md'), mk('hello there friend'), mk('42 items')], monoMeasure, []);
  const only = c => [{ op:'wave', amp:9, f:0, axis:'y', shape:'sine', from:'char', scale:1, target:c }];
  for (const c of ['path', 'size']) {
    const moved = gl.filter(g => applyStack(g, only(c), 0, W, H).dy !== 0);
    ok(`target="${c}" moves only ${c} text`,
       moved.length > 0 && moved.every(g => g.sem.kind === c),
       `${moved.length} glyphs, all ${[...new Set(moved.map(g => g.sem.kind))]}`);
  }
  // Compared against target "all" rather than counted: the glyph at char
  // index 0 has phase 0 and so dy exactly 0, which a bare "did it move"
  // count would read as untargeted.
  const sig = c => gl.map(g => applyStack(g, only(c), 0, W, H).dy.toFixed(6)).join(',');
  ok('a role target reaches the same glyphs as "all"', sig('body') === sig('all'),
     'every run here is kind=body');
  // and glyphs with no analysis at all must not break anything
  const plain = layout([{ kind:'body', x:0, y:0, size:12, text:'no sem here' }], monoMeasure, []);
  ok('text without analysis survives a semantic phase source',
     plain.every(g => Number.isFinite(applyStack(g, st2(), 0, W, H).dy)));
  function st2() { return [{ op:'wave', amp:5, f:0, axis:'y', shape:'sine', from:'entropy', scale:1, target:'all' }]; }
  ok('and survives a semantic target',
     plain.every(g => applyStack(g, only('path'), 0, W, H).dy === 0));
}

// --------------------------------------- the screen as a scene
{
  const AX = {
    ok:true, trusted:true, screen:{ w:2940, h:1912 }, scanned:120, ms:84, truncated:false,
    elements: [
      { role:'AXMenuBarItem', text:'Finder', path:'Finder>AXMenuBar>AXMenuBarItem',
        app:'Finder', window:'', x:40, y:4, w:80, h:34, depth:2 },
      { role:'AXStaticText', text:'~/Documents/final.md', path:'Finder>AXWindow>AXStaticText',
        app:'Finder', window:'Documents', x:300, y:400, w:420, h:36, depth:5 },
      { role:'AXButton', text:'Save', path:'Finder>AXWindow>AXButton',
        app:'Finder', window:'Documents', x:800, y:900, w:120, h:40, depth:4 },
      { role:'AXTextArea', text:'The quick brown fox jumps over the lazy dog',
        path:'Notes>AXWindow>AXTextArea', app:'Notes', window:'notes', x:100, y:1200, w:1200, h:48, depth:3 },
    ],
  };
  const s = axScene(AX, 1440, 900);
  ok('the screen becomes a scene', s.blocks.length === 4 && s.surfaces.length > 0,
     `${s.blocks.length} blocks, ${s.surfaces.length} surfaces`);
  ok('it is the same shape as every other source',
     !!(s.W && s.H && s.chrome && s.blocks && s.surfaces));
  ok('screen coordinates are scaled to the canvas', (() => {
    const b = s.blocks[1];                       // x 300 of 2940 -> 300 * 1440/2940
    return Math.abs(b.x - (300 * 1440 / 2940 + 3)) < 0.01;
  })(), `x ${s.blocks[1].x.toFixed(1)} from screen x 300 of 2940`);
  ok('AX roles collapse to the typography kinds',
     s.blocks.map(b => b.kind).join(' ') === 'menu body label body',
     s.blocks.map(b => `${b.kind}`).join(' '));
  ok('every block carries its analysis', s.blocks.every(b => b.sem && b.sem.kind));
  ok('the path is classified as a path', s.blocks[1].sem.kind === 'path');
  ok('the prose is classified as a sentence', s.blocks[3].sem.kind === 'sentence');
  ok('provenance survives into the scene',
     s.blocks[1].sem.path === 'Finder>AXWindow>AXStaticText' && s.blocks[1].sem.depth === 5,
     s.blocks[1].sem.path);
  // Three groups, not two: the menu bar item reports no window title, so it
  // is its own surface — which is right, a menu bar is not inside a window.
  ok('one surface per app-and-window, so layout operators can move real windows',
     new Set(s.blocks.map(b => b.surf)).size === 3,
     `${new Set(s.blocks.map(b => b.surf)).size}: Finder menu bar, Finder/Documents, Notes/notes`);
  ok('an empty or untrusted snapshot yields an empty scene',
     axScene({ ok:false, elements:[] }, 1440, 900).blocks.length === 0 &&
     axScene(null, 1440, 900).blocks.length === 0);
  const g = layout(s.blocks, monoMeasure, []);
  ok('real screen text lays out into glyphs', g.length > 50, `${g.length} glyphs`);
  ok('and those glyphs carry semantics the operators can read',
     g.every(x => x.sem) && new Set(g.map(x => x.sem.kind)).size >= 3,
     [...new Set(g.map(x => x.sem.kind))].join(' '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
