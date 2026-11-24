// The interface layer.
//
// Split in two, for a reason worth stating:
//
//   structural()  frames, ticks, reticles, bar wells. Drawn INTO the source
//                 raster, so the scan processor deflects and keys them exactly
//                 like the traffic. Under load the interface buckles.
//
//   overlay()     the dense numeric readouts. These are drawn at full
//                 resolution AFTER the chain, but each one samples the same
//                 deflection field and rides it. So the type moves with the
//                 image instead of floating above it, while staying legible.
//
// Rasterising small type through a 512x320 source would have destroyed it.
// Sampling the field keeps the coupling and keeps the numbers readable, which
// is the whole point of a readout.

import { P, rgba } from './palette.js';

const CH = [
  ['cpu.busy_pct',          'CPU BUSY',    100,    '%'],
  ['cpu.sys_pct',           'CPU SYS',     100,    '%'],
  ['load.1m',               'LOAD 1M',     16,     ''],
  ['disk.mb_per_s',         'DISK',        300,    'MB/s'],
  ['disk.tps',              'DISK TPS',    4000,   ''],
  ['vm.faults_per_s',       'FAULTS',      2.0e5,  '/s'],
  ['vm.pageins_per_s',      'PAGE IN',     2000,   '/s'],
  ['vm.pageouts_per_s',     'PAGE OUT',    1200,   '/s'],
  ['vm.compress_per_s',     'COMPRESS',    6000,   '/s'],
  ['vm.free_mb',            'FREE',        16384,  'MB'],
  ['vm.compressor_mb',      'COMPRESSOR',  8192,   'MB'],
  ['net.in_bytes_per_s',    'NET IN',      2.0e6,  'B/s'],
  ['net.out_bytes_per_s',   'NET OUT',     1.0e6,  'B/s'],
  ['net.retx_per_s',        'RETX',        20,     '/s'],
  ['net.rtt_avg_ms',        'RTT',         300,    'ms'],
  ['pwr.watts',             'POWER',       80,     'W'],
  ['fs.events',             'FS EVENTS',   30,     ''],
  ['in.cursor_speed',       'CURSOR',      4,      'px/ms'],
];

const BLOCKS = ' ▁▂▃▄▅▆▇█';
const HIST = 34;

function fmt(v) {
  if (v == null || Number.isNaN(v)) return '--';
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  if (a >= 100) return v.toFixed(0);
  if (a >= 10)  return v.toFixed(1);
  return v.toFixed(2);
}

export class FUI {
  constructor() {
    this.hist = new Map();
    for (const [k] of CH) this.hist.set(k, new Array(HIST).fill(0));
    this.tick = 0;
    this.warp = 0.40;          // how much the type rides the deflection field
    this.compact = false;      // persistent-panel mode: act + heroes, no dashboard
    this.dpr = 1;
  }

  push(raw) {
    if ((this.tick++ % 3) !== 0) return;            // ~10 Hz, enough for sparklines
    for (const [k, , ref] of CH) {
      const h = this.hist.get(k);
      h.push(Math.max(0, Math.min(1, (raw[k] || 0) / ref)));
      h.shift();
    }
  }

  spark(k) {
    const h = this.hist.get(k);
    let s = '';
    for (let i = 0; i < h.length; i++) {
      s += BLOCKS[Math.min(8, Math.max(0, Math.round(h[i] * 8)))];
    }
    return s;
  }

  // ------------------------------------------------ into the source raster
  structural(c, SW, SH) {
    c.strokeStyle = 'rgba(20,150,200,0.28)';
    c.lineWidth = 1;

    // outer frame with corner cuts — the classic FUI bracket
    const m = 10, cut = 26;
    c.beginPath();
    c.moveTo(m + cut, m); c.lineTo(SW - m - cut, m);
    c.moveTo(SW - m, m + cut); c.lineTo(SW - m, SH - m - cut);
    c.moveTo(SW - m - cut, SH - m); c.lineTo(m + cut, SH - m);
    c.moveTo(m, SH - m - cut); c.lineTo(m, m + cut);
    c.stroke();
    c.beginPath();
    c.moveTo(m, m + cut); c.lineTo(m + cut, m);
    c.moveTo(SW - m - cut, m); c.lineTo(SW - m, m + cut);
    c.moveTo(SW - m, SH - m - cut); c.lineTo(SW - m - cut, SH - m);
    c.moveTo(m + cut, SH - m); c.lineTo(m, SH - m - cut);
    c.stroke();

    // tick rail along the top: a ruler for the raster itself
    c.strokeStyle = 'rgba(20,150,200,0.22)';
    c.beginPath();
    for (let x = m + cut; x < SW - m - cut; x += 8) {
      const tall = ((x / 8) | 0) % 5 === 0;
      c.moveTo(x, m + 4); c.lineTo(x, m + (tall ? 11 : 7));
    }
    c.stroke();

    // bar wells down the left: empty containers that the readouts sit in,
    // so the interface has structure even where there is no data
    c.strokeStyle = 'rgba(20,150,200,0.16)';
    c.beginPath();
    for (let i = 0; i < 12; i++) {
      const y = 54 + i * 15;
      c.moveTo(m + 10, y); c.lineTo(m + 92, y);
    }
    c.stroke();

    // centre reticle on the CPU node
    c.strokeStyle = 'rgba(20,160,210,0.30)';
    const rx = SW * 0.5, ry = SH * 0.52, rr = 30;
    c.beginPath();
    c.arc(rx, ry, rr, 0, Math.PI * 2);
    c.moveTo(rx - rr - 8, ry); c.lineTo(rx - rr + 4, ry);
    c.moveTo(rx + rr - 4, ry); c.lineTo(rx + rr + 8, ry);
    c.moveTo(rx, ry - rr - 8); c.lineTo(rx, ry - rr + 4);
    c.moveTo(rx, ry + rr - 4); c.lineTo(rx, ry + rr + 8);
    c.stroke();
  }

  // ------------------------------------------------ crisp, field-displaced
  overlay(ctx, W, H, scan, raw, labels, phase, stats) {
    // The canvas is in device pixels, so at a 520x330 panel the normal scale
    // would land type at under 4 CSS px. Compact mode floors it against DPR.
    const u = this.compact
      ? Math.max(this.dpr * 0.95, Math.min(W, H) / 1000)
      : Math.min(W, H) / 1000;
    const F = s => `${(s * u).toFixed(1)}px ui-monospace, "SF Mono", Menlo, monospace`;
    const warp = this.warp;

    // Text rides the deflection field: sample where this line sits in source
    // space and take the same offset the scan processor applied there.
    const place = (nx, ny) => {
      const d = scan.deflectAt(nx, ny);
      return { x: nx * W + (d.x - nx * W) * warp * 0.5, y: ny * H + (d.y - ny * H) * warp, luma: d.luma };
    };

    ctx.textAlign = 'left';

    // ------------------------------------------------ compact (panel) mode
    // Act, travellers, one status line. The channel dashboard is unreadable
    // below roughly 900px wide, so it is dropped rather than shrunk.
    if (this.compact) {
      const a = place(0.05, 0.16);
      ctx.font = `700 ${(22 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = phase.key === 'ordeal' ? P.hudWarn : P.hudText;
      ctx.fillText(phase.name, a.x, a.y);
      ctx.font = F(9.5);
      ctx.fillStyle = P.hudDim;
      ctx.fillText(phase.why.toUpperCase(), a.x, a.y + 13 * u);

      const names = (stats.heroes || []).slice(0, 4);
      ctx.font = F(10);
      names.forEach((n, i) => {
        const p = place(0.05, 0.46 + i * 0.085);
        ctx.fillStyle = rgba(P.hero, 0.85);
        ctx.fillText('› ' + String(n).slice(-28), p.x, p.y);
      });
      if (!names.length) {
        const p = place(0.05, 0.46);
        ctx.fillStyle = rgba(P.flowDim, 0.7);
        ctx.fillText(labels['proc.top_name'] ? '· ' + labels['proc.top_name'] : '· quiet', p.x, p.y);
      }

      ctx.font = F(8.5);
      ctx.fillStyle = stats.demo ? P.hudWarn : stats.connected ? rgba(P.flowDim, 0.85) : P.hudWarn;
      ctx.fillText(
        stats.demo ? 'DEMO' :
        stats.connected ? `${stats.arrived} arrived · ${stats.parts} in flight` : 'NO DAEMON',
        W * 0.05, H * 0.93);
      return;
    }

    // ---- act / phase, top left
    {
      const p = place(0.035, 0.055);
      ctx.font = `700 ${(34 * u).toFixed(1)}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = phase.key === 'ordeal' ? P.hudWarn : P.hudText;
      ctx.fillText(phase.name, p.x, p.y);
      ctx.font = F(12);
      ctx.fillStyle = P.hudDim;
      ctx.fillText(phase.why.toUpperCase(), p.x, p.y + 19 * u);
    }

    // ---- dense channel readouts, left column
    ctx.font = F(11.5);
    CH.forEach(([k, name, ref, unit], i) => {
      const ny = 0.135 + i * 0.0425;
      if (ny > 0.93) return;
      const p = place(0.035, ny);
      const v = raw[k];
      const n = Math.max(0, Math.min(1, (v || 0) / ref));
      const warn = (k === 'net.retx_per_s' || k === 'vm.pageouts_per_s' || k === 'vm.compress_per_s') && n > 0.25;

      ctx.fillStyle = P.hudDim;
      ctx.fillText(name.padEnd(11), p.x, p.y);
      ctx.fillStyle = warn ? P.hudWarn : P.hudText;
      ctx.fillText((fmt(v) + unit).padStart(8), p.x + 86 * u, p.y);
      ctx.fillStyle = warn ? rgba(P.warn, 0.55) : rgba(P.flow, 0.45);
      ctx.fillText(this.spark(k), p.x + 150 * u, p.y);
    });

    // ---- right column: the named things currently in play
    ctx.textAlign = 'right';
    const rows = [
      ['FILE', labels['fs.last_path'] || '-'],
      ['PROC', labels['proc.top_name'] || '-'],
      ['HOST', labels['net.top_talker'] || '-'],
    ];
    rows.forEach((r, i) => {
      const p = place(0.965, 0.10 + i * 0.035);
      ctx.font = F(10.5); ctx.fillStyle = P.hudDim;
      ctx.fillText(r[0], p.x, p.y - 13 * u);
      ctx.font = F(12.5); ctx.fillStyle = P.hudText;
      ctx.fillText(String(r[1]).slice(-46), p.x, p.y);
    });

    // ---- synth parameters, right lower: the patch, shown as a patch
    const patch = [
      ['DEFLECT', scan.amp.toFixed(0)],
      ['PERSP',   scan.persp.toFixed(2)],
      ['KEY',     scan.key.toFixed(2)],
      ['SKEW',    scan.skew.toFixed(3)],
      ['FB GAIN', stats.gain.toFixed(3)],
      ['LINES',   String(Math.ceil(320 / scan.rowStep))],
    ];
    ctx.font = F(11);
    patch.forEach((r, i) => {
      const p = place(0.965, 0.58 + i * 0.030);
      ctx.fillStyle = P.hudDim; ctx.fillText(r[0], p.x - 52 * u, p.y);
      ctx.fillStyle = P.hudText; ctx.fillText(r[1], p.x, p.y);
    });

    // ---- status line
    ctx.textAlign = 'left';
    ctx.font = F(11);
    const p = place(0.035, 0.955);
    ctx.fillStyle = stats.demo ? P.hudWarn : stats.connected ? P.hudDim : P.hudWarn;
    ctx.fillText(
      stats.demo ? 'SYNTHETIC DEMO DATA'
        : stats.connected ? `LIVE  seq ${stats.seq}  ${stats.fps.toFixed(0)}fps  ${stats.parts} travellers  ${stats.arrived} arrived`
        : 'DAEMON NOT REACHABLE ON :7777',
      p.x, p.y);

    // Stage readout: shapes, chemistry, colouriser. rd === -1 means the GPU
    // path failed to start, and rdWhy says why — worth seeing rather than
    // silently getting no chemistry.
    const bits = [];
    if (stats.shapes) bits.push(`${stats.shapes} shape${stats.shapes > 1 ? 's' : ''}`);
    if (stats.rd === -1) bits.push(`RD OFF: ${stats.rdWhy || 'unavailable'}`);
    else if (stats.rd > 0.002) bits.push(`RD ${(stats.rd * 100).toFixed(0)}% · ${stats.rdIters} iter`);
    if (stats.colorizer && stats.colorizer !== 'legacy') bits.push(stats.colorizer);
    if (bits.length) {
      const q = place(0.035, 0.925);
      ctx.fillStyle = stats.rd === -1 ? P.hudWarn : rgba(P.flowDim, 0.85);
      ctx.fillText(bits.join('   '), q.x, q.y);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = rgba(P.flowDim, 0.8);
    ctx.fillText('space pause  f field  s scan  g shapes  r chemistry  t warp  d demo  [ ] gain  c clear',
      W * 0.965, H * 0.955);
    ctx.textAlign = 'left';
  }
}
