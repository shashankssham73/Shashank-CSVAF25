const C = require('./core.js'); const D = require('./dsp.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const W = 20, H = 12, cells = C.paintFromArt(C.PAINT_EXAMPLE, W, H);
const r = C.compilePaint(cells, W, H, C.defaultGraph());
console.log(r.report.join('\n'));
const g = r.graph, inn = (id, port) => g.nodes[id].in[port] && g.nodes[id].in[port].from;
ok(r.regions === 7, 'found 7 regions, got ' + r.regions);
ok(inn('rotate1', 'shape') === 'star1' && inn('rotate1', 'deg') === 'lfo1', 'star -> rotate.shape, lfo -> rotate.deg');
ok(inn('warp1', 'shape') === 'rotate1' && inn('warp1', 'ampx') === 'tele1', 'rotate -> warp.shape, tele -> warp.ampx');
ok(inn('render', 'shape') === 'warp1' && inn('render', 'pal') === 'palette1', 'warp -> render.shape, palette -> render.pal');
ok(Object.keys(g.nodes).length === 8, 'graph has 6 modules (+render, mask)');
const out = C.evaluate(g, { t: 0, dt: 0.03, outs: {}, SPEC: D.SPEC }); ok(out.render !== undefined, 'compiled graph evaluates');
// empty paint: no crash, warns
const e = C.compilePaint(new Uint8Array(W * H), W, H, C.defaultGraph()); ok(e.report.some((l) => l.startsWith('! no white')), 'empty canvas warns about missing render');
// two shapes into one rotate: second is reported, not silently dropped
const a2 = C.PAINT_EXAMPLE.slice(); a2[4] = 'SSS.RRRR............';
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
