#!/usr/bin/env node
// The patch map: which of the 43 measured channels is wired to what, and which
// are still free. Generated from the same tables the renderer uses.
const fs = require('fs'), path = require('path');

const GROUPS = [
  ['CPU',        ['cpu.user_pct','cpu.sys_pct','cpu.idle_pct','cpu.busy_pct','load.1m','proc.top_cpu_pct']],
  ['STORAGE',    ['disk.tps','disk.mb_per_s','disk.kb_per_tx']],
  ['MEMORY',     ['vm.faults_per_s','vm.cow_per_s','vm.zerofill_per_s','vm.pageins_per_s','vm.pageouts_per_s',
                  'vm.compress_per_s','vm.decompress_per_s','vm.free_mb','vm.active_mb','vm.wired_mb',
                  'vm.compressor_mb','vm.compressed_logical_mb']],
  ['NETWORK',    ['net.in_bytes_per_s','net.out_bytes_per_s','net.retx_per_s','net.dupe_per_s','net.ooo_per_s',
                  'net.rtt_avg_ms','net.active_procs']],
  ['POWER',      ['pwr.volts','pwr.amps','pwr.watts','pwr.batt_temp_c','pwr.charging']],
  ['FILESYSTEM', ['fs.events']],
  ['INPUT',      ['in.pressure','in.stage','in.cursor_x','in.cursor_y','in.cursor_speed',
                  'in.scroll_dy','in.scroll_dx','in.clicks','in.events']],
];

const PATCH = {
  'cpu.busy_pct':['scan.amp','scan.persp','fb.zoom'], 'cpu.user_pct':['ring'], 'cpu.sys_pct':['ring'],
  'load.1m':['readout'],
  'disk.tps':['bus.disk_out'], 'disk.mb_per_s':['bus.disk_in'],
  'vm.faults_per_s':['bus.fault'], 'vm.cow_per_s':['bus.cow'], 'vm.pageins_per_s':['bus.pagein'],
  'vm.pageouts_per_s':['bus.pageout','scan.key','scan.skew','hero.death'],
  'vm.compress_per_s':['bus.compress'], 'vm.decompress_per_s':['bus.decomp'],
  'vm.free_mb':['readout'], 'vm.active_mb':['readout'], 'vm.compressor_mb':['readout'],
  'net.in_bytes_per_s':['bus.net_in'], 'net.out_bytes_per_s':['bus.net_out'],
  'net.retx_per_s':['bus.net_in','scan.skew'], 'net.dupe_per_s':['bus.net_in'], 'net.ooo_per_s':['bus.net_in'],
  'net.rtt_avg_ms':['readout'], 'pwr.watts':['readout'],
  'fs.events':['bus.fsev','hero.spawn'], 'in.cursor_speed':['readout'], 'in.events':['bus.input'],
};
const WARN = new Set(['vm.pageouts_per_s','vm.compress_per_s','net.retx_per_s','net.dupe_per_s','net.ooo_per_s']);

const DEST = [
  ['BUS EMISSION', [
    ['bus.net_in','net_in'],['bus.net_out','net_out'],['bus.disk_in','disk_in'],['bus.disk_out','disk_out'],
    ['bus.fault','fault'],['bus.cow','cow'],['bus.pagein','pagein'],['bus.pageout','pageout'],
    ['bus.compress','compress'],['bus.decomp','decomp'],['bus.input','input'],['bus.fsev','fsev']]],
  ['SCAN PROCESSOR', [['scan.amp','deflection amplitude'],['scan.persp','perspective depth'],
    ['scan.key','colour key threshold'],['scan.skew','raster tear']]],
  ['FEEDBACK',  [['fb.zoom','zoom + rotation']]],
  ['TRAVELLERS',[['hero.spawn','hero spawn'],['hero.death','hero loss']]],
  ['DIRECT',    [['ring','CPU occupancy ring'],['readout','numeric readout only']]],
  ['NOT PATCHED', [['free','FREE INPUTS — measured, streaming, driving nothing']]],
];

const C = { ink:'#101418', mute:'#63707e', rule:'#ccd4dd', wash:'#f5f7f9', panel:'#fff',
            cyan:'#0f7fa0', cyanL:'rgba(21,150,190,0.40)', amber:'#c2610d',
            amberL:'rgba(200,110,25,0.50)', grey:'#9aa6b2', greyL:'rgba(150,165,180,0.40)',
            free:'#7a4bb8', freeL:'rgba(122,75,184,0.42)' };
const MONO = "ui-monospace,'SF Mono',Menlo,monospace", SANS = "-apple-system,Helvetica,Arial,sans-serif";

const ROW = 21, GH = 26, TOP = 108;
const LX = 40, LW = 330, RX = 1010, RW = 560;

// lay out left
const L = []; let y = TOP;
for (const [g, chs] of GROUPS) {
  L.push({ hdr: g, y });
  y += GH;
  for (const ch of chs) { L.push({ ch, y }); y += ROW; }
  y += 6;
}
const leftBottom = y;

// lay out right, vertically centred against the left
let rh = 0;
for (const [, items] of DEST) rh += GH + items.length * ROW + 6;
let ry = TOP + Math.max(0, (leftBottom - TOP - rh) / 2);
const R = new Map(); const RHDR = [];
for (const [g, items] of DEST) {
  RHDR.push({ hdr: g, y: ry }); ry += GH;
  for (const [k, label] of items) { R.set(k, { y: ry, label }); ry += ROW; }
  ry += 6;
}
const H = Math.max(leftBottom, ry) + 132, W = 1620;

const out = [], P = s => out.push(s);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
P(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">`);
P(`<rect width="${W}" height="${H}" fill="${C.panel}"/>`);
P(`<text x="40" y="42" font-size="20" font-weight="700" fill="${C.ink}">Signal patch map — what every measured channel is wired to</text>`);
P(`<text x="40" y="66" font-size="12.5" fill="${C.mute}">All 43 channels the daemon streams. Cyan = patched and driving the image. Amber = a contention channel, drives the warning colour. Purple = measured and streaming, driving nothing yet.</text>`);
P(`<text x="40" y="86" font-size="12.5" fill="${C.mute}">Conditioning on every link is the same: value → log1p(v)/log1p(ref) with a decaying peak tracker on ref → exponential moving average (α 0.10). No FFT, STFT or autocorrelation anywhere in the chain yet.</text>`);

// links first, under the labels
let nFree = 0, nPatched = 0;
for (const n of L) {
  if (!n.ch) continue;
  const targets = PATCH[n.ch] || [];
  const y1 = n.y + ROW / 2;
  if (!targets.length) {
    nFree++;
    const r = R.get('free'), y2 = r.y + ROW / 2;
    P(`<path d="M${LX+LW},${y1} C${LX+LW+150},${y1} ${RX-150},${y2} ${RX},${y2}" fill="none" stroke="${C.freeL}" stroke-width="1.1" stroke-dasharray="3 3"/>`);
    continue;
  }
  nPatched++;
  for (const t of targets) {
    const r = R.get(t); if (!r) continue;
    const y2 = r.y + ROW / 2;
    const col = WARN.has(n.ch) ? C.amberL : (t === 'readout' ? C.greyL : C.cyanL);
    P(`<path d="M${LX+LW},${y1} C${LX+LW+150},${y1} ${RX-150},${y2} ${RX},${y2}" fill="none" stroke="${col}" stroke-width="1.25"/>`);
  }
}

// left column
for (const n of L) {
  if (n.hdr) {
    P(`<text x="${LX}" y="${n.y+17}" font-size="11" font-weight="700" letter-spacing="1.3" fill="${C.ink}">${esc(n.hdr)}</text>`);
    P(`<line x1="${LX}" y1="${n.y+22}" x2="${LX+LW}" y2="${n.y+22}" stroke="${C.rule}"/>`);
    continue;
  }
  const free = !(PATCH[n.ch] || []).length;
  const col = free ? C.free : WARN.has(n.ch) ? C.amber : C.cyan;
  P(`<rect x="${LX}" y="${n.y+2}" width="${LW}" height="${ROW-4}" fill="${free ? '#faf7fe' : C.wash}" rx="2"/>`);
  P(`<rect x="${LX}" y="${n.y+2}" width="3" height="${ROW-4}" fill="${col}" rx="1.5"/>`);
  P(`<text x="${LX+12}" y="${n.y+15}" font-size="10.5" font-family="${MONO}" fill="${C.ink}">${esc(n.ch)}</text>`);
  P(`<circle cx="${LX+LW-8}" cy="${n.y+ROW/2}" r="2.6" fill="${col}"/>`);
}

// right column
for (const h of RHDR) {
  P(`<text x="${RX}" y="${h.y+17}" font-size="11" font-weight="700" letter-spacing="1.3" fill="${C.ink}">${esc(h.hdr)}</text>`);
  P(`<line x1="${RX}" y1="${h.y+22}" x2="${RX+RW}" y2="${h.y+22}" stroke="${C.rule}"/>`);
}
for (const [k, r] of R) {
  const isFree = k === 'free';
  P(`<rect x="${RX}" y="${r.y+2}" width="${RW}" height="${ROW-4}" fill="${isFree ? '#faf7fe' : C.wash}" rx="2"/>`);
  P(`<rect x="${RX+RW-3}" y="${r.y+2}" width="3" height="${ROW-4}" fill="${isFree ? C.free : C.cyan}" rx="1.5"/>`);
  P(`<circle cx="${RX+8}" cy="${r.y+ROW/2}" r="2.6" fill="${isFree ? C.free : C.cyan}"/>`);
  P(`<text x="${RX+20}" y="${r.y+15}" font-size="10.5" font-family="${MONO}" fill="${C.ink}">${esc(r.label)}</text>`);
}

// footer
const fy = H - 78;
P(`<line x1="40" y1="${fy-22}" x2="${W-40}" y2="${fy-22}" stroke="${C.rule}"/>`);
P(`<text x="40" y="${fy}" font-size="12" font-family="${MONO}" fill="${C.ink}">${nPatched} channels patched · ${nFree} free · ${nPatched+nFree} measured in total</text>`);
P(`<text x="40" y="${fy+20}" font-size="11" font-family="${MONO}" fill="${C.mute}">KIND decides what is legal: level = filter/STFT/autocorrelate, never differentiate · rate = log1p first, already a derivative · event = convolve to an envelope before any spectral work · state = edges only</text>`);
P(`<text x="40" y="${fy+38}" font-size="11" font-family="${MONO}" fill="${C.mute}">The purple block is your free surface: 18 channels already streaming at full rate, costing nothing extra, currently driving nothing.</text>`);
P(`<text x="${W-40}" y="${fy+38}" font-size="10" font-family="${MONO}" fill="${C.rule}" text-anchor="end">figures/make-signal-map.js</text>`);
P(`</svg>`);

fs.writeFileSync(path.join(__dirname, 'signal-map.svg'), out.join('\n'));
console.log(`patched=${nFree+nPatched===43?'ok':'MISMATCH'} total=${nPatched+nFree} patched=${nPatched} free=${nFree} canvas=${W}x${H}`);
