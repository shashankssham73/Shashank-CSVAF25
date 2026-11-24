#!/usr/bin/env node
'use strict';
/*
 * M0 — telemetry daemon.  Zero dependencies, Node >= 16.
 *
 * Samples the unprivileged signal sources available on macOS 15.5 and emits
 * uniform frames over SSE at a fixed rate.  Deliberately dumb: it does NOT
 * normalize, smooth, or map anything.  Raw numbers only.  All transformation
 * belongs downstream (see 00-RESEARCH-MAP.md, Layer B) so you can see what the
 * signals actually look like before deciding what to do with them.
 *
 *   node telemetryd.js                      # serve scope on http://localhost:7777
 *   node telemetryd.js --hz 60              # faster frame rate
 *   node telemetryd.js --stdout > out.ndjson
 *   node telemetryd.js --watch ~/Desktop,~/Documents
 *   node telemetryd.js --no-top             # drop the per-process CPU source
 */

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------- args

const ARGS = (() => {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    // Both forms. `--port=7788` silently did nothing and the daemon then
    // failed on the default port instead, which reads as "the port flag is
    // broken" rather than "that spelling is unsupported".
    const eq = t.indexOf('=');
    if (eq > 2) { a[t.slice(2, eq)] = t.slice(eq + 1); continue; }
    const k = t.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[k] = true;
    else { a[k] = next; i++; }
  }
  return a;
})();

const PORT       = +(ARGS.port || 7777);
const FRAME_HZ   = +(ARGS.hz || 30);
const PAGE_BYTES = 16384;                        // confirmed via vm_stat on this machine
const ROOT       = __dirname;
const WATCH_DIRS = String(ARGS.watch || '~/Desktop,~/Documents,~/Downloads')
  .split(',').map(s => s.trim()).filter(Boolean)
  .map(s => s.replace(/^~/, os.homedir()));

// ---------------------------------------------------------------- channel registry
// kind: level    = absolute quantity, use as-is
//       rate     = already differentiated (per second)
//       counter  = cumulative, YOU must differentiate
//       event    = count of discrete occurrences in this frame
//       state    = categorical / boolean
// This column is the whole point: it tells you which DSP is legal on each channel.

const CHANNELS = {
  // --- cpu / load (iostat) -------------------------------------------------
  'cpu.user_pct':        { unit: '%',    kind: 'level', hint: [0, 100] },
  'cpu.sys_pct':         { unit: '%',    kind: 'level', hint: [0, 100] },
  'cpu.idle_pct':        { unit: '%',    kind: 'level', hint: [0, 100] },
  'cpu.busy_pct':        { unit: '%',    kind: 'level', hint: [0, 100] },
  'load.1m':             { unit: '',     kind: 'level', hint: [0, 16] },

  // --- disk (iostat) -------------------------------------------------------
  'disk.tps':            { unit: 'tx/s', kind: 'rate',  hint: [0, 2000] },
  'disk.mb_per_s':       { unit: 'MB/s', kind: 'rate',  hint: [0, 200] },
  'disk.kb_per_tx':      { unit: 'KB',   kind: 'level', hint: [0, 256] },

  // --- virtual memory (vm_stat) -------------------------------------------
  'vm.faults_per_s':     { unit: '1/s',  kind: 'rate',  hint: [0, 200000] },
  'vm.cow_per_s':        { unit: '1/s',  kind: 'rate',  hint: [0, 20000] },
  'vm.zerofill_per_s':   { unit: '1/s',  kind: 'rate',  hint: [0, 100000] },
  'vm.pageins_per_s':    { unit: '1/s',  kind: 'rate',  hint: [0, 5000] },
  'vm.pageouts_per_s':   { unit: '1/s',  kind: 'rate',  hint: [0, 5000] },
  'vm.compress_per_s':   { unit: '1/s',  kind: 'rate',  hint: [0, 20000] },
  'vm.decompress_per_s': { unit: '1/s',  kind: 'rate',  hint: [0, 20000] },
  'vm.free_mb':          { unit: 'MB',   kind: 'level', hint: [0, 16384] },
  'vm.active_mb':        { unit: 'MB',   kind: 'level', hint: [0, 16384] },
  'vm.wired_mb':         { unit: 'MB',   kind: 'level', hint: [0, 16384] },
  'vm.compressor_mb':    { unit: 'MB',   kind: 'level', hint: [0, 16384] },
  'vm.compressed_logical_mb': { unit: 'MB', kind: 'level', hint: [0, 40000] },

  // --- network (nettop, unprivileged) -------------------------------------
  'net.in_bytes_per_s':  { unit: 'B/s',  kind: 'rate',  hint: [0, 10e6] },
  'net.out_bytes_per_s': { unit: 'B/s',  kind: 'rate',  hint: [0, 10e6] },
  'net.retx_per_s':      { unit: '1/s',  kind: 'rate',  hint: [0, 200] },
  'net.dupe_per_s':      { unit: '1/s',  kind: 'rate',  hint: [0, 200] },
  'net.ooo_per_s':       { unit: '1/s',  kind: 'rate',  hint: [0, 200] },
  'net.rtt_avg_ms':      { unit: 'ms',   kind: 'level', hint: [0, 500] },
  'net.active_procs':    { unit: '',     kind: 'level', hint: [0, 80] },

  // --- power / thermal (ioreg AppleSmartBattery) ---------------------------
  'pwr.volts':           { unit: 'V',    kind: 'level', hint: [10, 14] },
  'pwr.amps':            { unit: 'A',    kind: 'level', hint: [-6, 6] },
  'pwr.watts':           { unit: 'W',    kind: 'level', hint: [-60, 60] },
  'pwr.batt_temp_c':     { unit: 'C',    kind: 'level', hint: [20, 45] },
  'pwr.charging':        { unit: '',     kind: 'state', hint: [0, 1] },

  // --- filesystem (FSEvents via fs.watch) ---------------------------------
  'fs.events':           { unit: '',     kind: 'event', hint: [0, 50] },

  // --- input (native pressure-probe) --------------------------------------
  'in.pressure':         { unit: '',     kind: 'level', hint: [0, 1] },
  'in.stage':            { unit: '',     kind: 'state', hint: [0, 2] },
  'in.cursor_x':         { unit: 'px',   kind: 'level', hint: [0, 2560] },
  'in.cursor_y':         { unit: 'px',   kind: 'level', hint: [0, 1664] },
  'in.cursor_speed':     { unit: 'px/s', kind: 'level', hint: [0, 6000] },
  'in.scroll_dy':        { unit: 'px',   kind: 'event', hint: [-200, 200] },
  'in.scroll_dx':        { unit: 'px',   kind: 'event', hint: [-200, 200] },
  'in.clicks':           { unit: '',     kind: 'event', hint: [0, 5] },
  'in.events':           { unit: '',     kind: 'event', hint: [0, 60] },

  // --- per-process (top) ---------------------------------------------------
  'proc.top_cpu_pct':    { unit: '%',    kind: 'level', hint: [0, 800] },
};

// Live values. Event-kind channels are zeroed after every frame.
const state = {};
for (const k of Object.keys(CHANNELS)) state[k] = 0;

const labels  = { 'net.top_talker': '-', 'fs.last_path': '-', 'proc.top_name': '-' };
const sources = {};   // name -> { status, note, lines, lastLine }

function markSource(name, status, note) {
  sources[name] = Object.assign(sources[name] || { lines: 0 }, { status, note: note || '' });
}

// ---------------------------------------------------------------- source helper

function startSource(name, cmd, args, onLine, opts = {}) {
  markSource(name, 'starting');
  if (opts.onSpawn) opts.onSpawn();          // let the source reset its parse state
  let child;
  try {
    // stdin MUST be a pipe, not 'ignore'.  nettop is interactive (it reads keypresses
    // like 'h' for help); with stdin on /dev/null it gets instant EOF forever, busy-spins
    // a core at ~135% CPU and emits NOTHING.  With a pipe: 0% CPU and normal output.
    // Measured on macOS 15.5.  Other interactive samplers (top) are the same shape.
    child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    markSource(name, 'failed', String(e.message));
    return null;
  }
  let buf = '';
  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      sources[name].lines = (sources[name].lines || 0) + 1;
      if (sources[name].status !== 'ok') markSource(name, 'ok');
      try { onLine(line); } catch (e) { /* never let a parse bug kill the daemon */ }
    }
  });
  child.stderr.on('data', d => {
    const s = d.toString().trim();
    if (/must be run as root|superuser|not permitted/i.test(s)) markSource(name, 'needs-root', s.split('\n')[0]);
    else if (s) markSource(name, sources[name].status === 'ok' ? 'ok' : 'warn', s.split('\n')[0]);
  });
  child.on('exit', code => {
    markSource(name, 'exited', 'code ' + code);
    if (opts.restart !== false) setTimeout(() => startSource(name, cmd, args, onLine, opts), 2000);
  });
  return child;
}

const children = [];
const num = s => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0; };

// Handles vm_stat's K/M suffixes ("699721K").
function suffixed(tok) {
  if (!tok) return 0;
  const m = /^([0-9.]+)([KMG]?)$/.exec(tok.trim());
  if (!m) return num(tok);
  const mult = { '': 1, K: 1e3, M: 1e6, G: 1e9 }[m[2]];
  return parseFloat(m[1]) * mult;
}

// ---------------------------------------------------------------- 1. vm_stat
// `vm_stat 1` prints one row per second.  Level columns are absolute; counter
// columns are already deltas for the interval (i.e. per-second rates).
// The FIRST data row is cumulative since boot — we drop it.
{
  let header = null, firstRow = true;
  children.push(startSource('vm_stat', 'vm_stat', ['1'], line => {
    const t = line.trim();
    if (!t) return;
    if (/^Mach Virtual Memory/.test(t)) return;
    if (/free\s+active/.test(t)) { header = t.split(/\s+/); return; }
    if (!header) return;
    const v = t.split(/\s+/).map(suffixed);
    if (v.length < header.length - 2) return;
    const get = n => { const i = header.indexOf(n); return i < 0 ? 0 : v[i]; };
    if (firstRow) { firstRow = false; return; }        // since-boot totals
    const mb = p => (p * PAGE_BYTES) / 1048576;
    state['vm.free_mb']          = mb(get('free'));
    state['vm.active_mb']        = mb(get('active'));
    state['vm.wired_mb']         = mb(get('wired'));
    // 'cmprssed' = pages that were compressed, counted at their ORIGINAL size, so it
    // legitimately exceeds installed RAM.  'cmprssor' = pages the compressor actually
    // occupies.  Only the latter is a real memory footprint.
    state['vm.compressed_logical_mb'] = mb(get('cmprssed'));
    state['vm.compressor_mb']         = mb(get('cmprssor'));
    state['vm.faults_per_s']     = get('faults');
    state['vm.cow_per_s']        = get('copy');
    state['vm.zerofill_per_s']   = get('0fill');
    state['vm.pageins_per_s']    = get('pageins');
    state['vm.pageouts_per_s']   = get('pageout');
    state['vm.compress_per_s']   = get('comprs');
    state['vm.decompress_per_s'] = get('dcomprs');
  }));
}

// ---------------------------------------------------------------- 2. iostat
// `iostat -w 1` -> per-disk (KB/t tps MB/s) * N, then cpu (us sy id), then load (1m 5m 15m).
// Disk count is read from the header line.  First data row is a since-boot average.
{
  let nDisks = 0, firstRow = true;
  children.push(startSource('iostat', 'iostat', ['-w', '1'], line => {
    const t = line.trim();
    if (!t) return;
    if (/disk\d/.test(t)) { nDisks = (t.match(/disk\d+/g) || []).length; return; }
    if (/KB\/t/.test(t)) return;
    if (!nDisks) return;
    const v = t.split(/\s+/).map(num);
    if (v.length < nDisks * 3 + 6) return;
    if (firstRow) { firstRow = false; return; }
    const c = nDisks * 3;
    state['disk.kb_per_tx'] = v[0];
    state['disk.tps']       = v[1];
    state['disk.mb_per_s']  = v[2];
    state['cpu.user_pct']   = v[c];
    state['cpu.sys_pct']    = v[c + 1];
    state['cpu.idle_pct']   = v[c + 2];
    state['cpu.busy_pct']   = 100 - v[c + 2];
    state['load.1m']        = v[c + 3];
  }));
}

// ---------------------------------------------------------------- 3. nettop
// Unprivileged per-process network counters.  Four traps, all measured on macOS 15.5:
//   1. -L 0 ("treated as infinity" per the man page) emits nothing and spins a core.
//      Use a finite count; startSource() respawns the child when it exits.
//   2. With stdin on /dev/null nettop busy-spins at ~135% CPU and emits NOTHING.
//      startSource() gives every child a real stdin pipe.  (-c makes no difference
//      once stdin is correct.)
//   3. -J replaces the ENTIRE column set, so 'time' must be requested explicitly.
//   4. The CSV header is reprinted before EVERY sample, and the 'time' field
//      increments ~1us per row, so rows in one sample do NOT share a timestamp.
//      The header line is therefore the sample boundary; a time gap is the fallback.
// Output through a pipe is block-buffered: the first sample lands ~6 s after launch
// and later ones arrive in bursts of ~2 s, so net.* is chunky by nature.
{
  const COLS = ['time', 'bytes_in', 'bytes_out', 'rx_dupe', 'rx_ooo', 're-tx', 'rtt_avg'];
  const SAMPLES = 600;
  const GAP_S = 0.2;

  // "23:06:46.335632" -> seconds of day
  const parseT = str => {
    const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(str.trim());
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : NaN;
  };

  const newAcc = () => ({ bin: 0, bout: 0, dupe: 0, ooo: 0, retx: 0, rttSum: 0, rttN: 0,
                          active: 0, topBytes: 0, topName: '' });

  let header = null, acc = null, sampleT = NaN, nSamples = 0;

  const flush = () => {
    if (!acc) return;
    nSamples++;
    // nettop's first sample is cumulative-since-launch, not a delta.  Drop it.
    if (nSamples <= 1) { acc = null; return; }
    state['net.in_bytes_per_s']  = acc.bin;
    state['net.out_bytes_per_s'] = acc.bout;
    state['net.dupe_per_s']      = acc.dupe;
    state['net.ooo_per_s']       = acc.ooo;
    state['net.retx_per_s']      = acc.retx;
    state['net.rtt_avg_ms']      = acc.rttN ? acc.rttSum / acc.rttN : 0;
    state['net.active_procs']    = acc.active;
    labels['net.top_talker']     = acc.topName || '-';
    acc = null;
  };

  children.push(startSource('nettop', 'nettop',
    ['-P', '-d', '-x', '-s', '1', '-L', String(SAMPLES), '-J', COLS.join(',')], line => {
      const t = line.trim();
      if (!t) return;
      if (/^time,/.test(t)) {                 // header == start of a new sample
        header = t.split(',').map(x => x.trim());
        flush();
        acc = newAcc();
        sampleT = NaN;
        return;
      }
      if (!header || !acc) return;
      const f = t.split(',');
      const ts = parseT(f[0]);
      if (!Number.isFinite(ts)) return;
      if (!Number.isFinite(sampleT)) sampleT = ts;
      else if (Math.abs(ts - sampleT) > GAP_S) { flush(); acc = newAcc(); sampleT = ts; }

      const get = n => { const i = header.indexOf(n); return i < 0 ? 0 : num(f[i]); };
      const bin = get('bytes_in'), bout = get('bytes_out');
      acc.bin += bin; acc.bout += bout;
      acc.dupe += get('rx_dupe'); acc.ooo += get('rx_ooo'); acc.retx += get('re-tx');
      const rtt = get('rtt_avg');
      if (rtt > 0) { acc.rttSum += rtt; acc.rttN++; }
      if (bin + bout > 0) acc.active++;
      if (bin + bout > acc.topBytes) { acc.topBytes = bin + bout; acc.topName = (f[1] || '').trim(); }
    },
    // a fresh child restarts the cumulative-first-sample cycle
    { onSpawn: () => { header = null; acc = null; sampleT = NaN; nSamples = 0; } }));
}

// ---------------------------------------------------------------- 4. power / thermal
// ioreg AppleSmartBattery, polled.  Amperage is battery current: NEGATIVE while
// discharging (and reported as a 64-bit two's complement value), positive while
// charging.  On AC with a full battery it sits near zero regardless of load, so
// this is only a system-power proxy when running on battery.  Temperature is in
// hundredths of a degree C and IS a genuine always-available thermal sensor.
{
  const TWO64 = 18446744073709551616;
  const poll = () => {
    const p = spawn('ioreg', ['-rn', 'AppleSmartBattery'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.on('exit', () => {
      const grab = key => {
        const m = new RegExp('"' + key + '"\\s*=\\s*(-?\\d+)').exec(out);
        if (!m) return null;
        let v = Number(m[1]);
        if (v > 9e18) v -= TWO64;            // unsigned-wrapped negative current
        return v;
      };
      const mV = grab('Voltage'), mA = grab('InstantAmperage') ?? grab('Amperage');
      const tC = grab('Temperature');
      if (mV !== null) state['pwr.volts'] = mV / 1000;
      if (mA !== null) state['pwr.amps'] = mA / 1000;
      if (mV !== null && mA !== null) state['pwr.watts'] = (mV / 1000) * (mA / 1000);
      if (tC !== null) state['pwr.batt_temp_c'] = tC / 100;
      state['pwr.charging'] = /"IsCharging"\s*=\s*Yes/.test(out) ? 1 : 0;
      markSource('ioreg', 'ok');
    });
    p.on('error', e => markSource('ioreg', 'failed', e.message));
  };
  poll();
  setInterval(poll, 2000).unref?.();
}

// ---------------------------------------------------------------- 5. FSEvents
// Node's recursive fs.watch is backed by FSEvents on macOS: one cheap watcher
// per tree, coalesced by the OS.  Good for structure changes, NOT for rhythm.
{
  const NOISE = /\/(\.git|node_modules|\.DS_Store|\.Trash)(\/|$)/;
  let alive = 0;
  for (const dir of WATCH_DIRS) {
    try {
      const w = fs.watch(dir, { recursive: true, persistent: true }, (evt, fname) => {
        if (!fname) return;
        const full = path.join(dir, fname);
        if (NOISE.test(full)) return;
        state['fs.events'] += 1;
        labels['fs.last_path'] = full.replace(os.homedir(), '~');
      });
      w.on('error', () => {});
      alive++;
    } catch (e) { /* unreadable dir */ }
  }
  markSource('fsevents', alive ? 'ok' : 'failed', alive + '/' + WATCH_DIRS.length + ' dirs');
}

// ---------------------------------------------------------------- 6. input probe
// The only native component. Emits NDJSON; see src/pressure-probe.swift.
{
  const bin = path.join(ROOT, 'bin', 'pressure-probe');
  if (!fs.existsSync(bin)) {
    markSource('input', 'missing', 'run: swiftc -O -o bin/pressure-probe src/pressure-probe.swift -framework AppKit');
  } else {
    let sawEvent = false;
    children.push(startSource('input', bin, [], line => {
      if (!line.trim()) return;
      const e = JSON.parse(line);
      if (e.type === 'hello') { markSource('input', 'waiting', 'no input events yet'); return; }
      if (!sawEvent) { sawEvent = true; markSource('input', 'ok'); }
      state['in.events'] += 1;
      if (typeof e.x === 'number') {
        state['in.cursor_x'] = e.x;
        state['in.cursor_y'] = e.y;
      }
      if (typeof e.pressure === 'number') state['in.pressure'] = e.pressure;
      if (typeof e.stage === 'number') state['in.stage'] = e.stage;
      if (e.type === 'scroll') { state['in.scroll_dx'] += e.dx || 0; state['in.scroll_dy'] += e.dy || 0; }
      if (e.type === 'down') state['in.clicks'] += 1;
    }));
  }
}

// ---------------------------------------------------------------- 7. top (per-process CPU)
// `top -l 0` streams samples.  We only take the busiest process as a label plus
// its %CPU, which is a surprisingly good "what is the machine doing" signal.
if (!ARGS['no-top']) {
  let inRows = false;
  // Measured cost on M3: -s 2 => ~0.9% of a core, -s 5 => ~0.3%.  A `ps -Ao pcpu`
  // poll at 1 Hz costs ~2%, i.e. worse, because of the per-poll fork.
  const TOP_S = String(ARGS['top-interval'] || 3);
  children.push(startSource('top', 'top',
    ['-l', '0', '-s', TOP_S, '-n', '5', '-o', 'cpu', '-stats', 'command,cpu'], line => {
      const t = line.trim();
      if (!t) return;
      if (/^COMMAND\s+%CPU/i.test(t)) { inRows = true; return; }
      if (/^Processes:/.test(t)) { inRows = false; return; }
      if (!inRows) return;
      const m = /^(.*?)\s+([\d.]+)\s*$/.exec(t);
      if (!m) return;
      state['proc.top_cpu_pct'] = num(m[2]);
      labels['proc.top_name'] = m[1].trim();
      inRows = false;                                  // only the first (busiest) row
    }));
}

// ---------------------------------------------------------------- frames

const EVENT_CH = Object.keys(CHANNELS).filter(k => CHANNELS[k].kind === 'event');
let seq = 0;
const subscribers = new Set();
let recordStream = null;

// Derived per-frame rather than per-event, so it decays to 0 when the mouse stops
// instead of freezing at the last observed speed.
let _lx = 0, _ly = 0, _lt = 0;
function updateCursorSpeed(now) {
  const x = state['in.cursor_x'], y = state['in.cursor_y'];
  if (_lt) { const dt = now - _lt; if (dt > 0) state['in.cursor_speed'] = Math.hypot(x - _lx, y - _ly) / dt; }
  _lx = x; _ly = y; _lt = now;
}

function tick() {
  const now = Date.now() / 1000;
  updateCursorSpeed(now);
  const frame = { seq: seq++, t: now, ch: Object.assign({}, state), lab: Object.assign({}, labels) };
  for (const k of EVENT_CH) state[k] = 0;             // event counters reset per frame

  const payload = 'data: ' + JSON.stringify(frame) + '\n\n';
  for (const res of subscribers) { try { res.write(payload); } catch (e) { subscribers.delete(res); } }
  if (recordStream) recordStream.write(JSON.stringify(frame) + '\n');
  if (ARGS.stdout) process.stdout.write(JSON.stringify(frame) + '\n');
}
setInterval(tick, Math.max(4, Math.round(1000 / FRAME_HZ)));

// status frames are small and let the scope show which sources are alive
setInterval(() => {
  const payload = 'event: status\ndata: ' + JSON.stringify(sources) + '\n\n';
  for (const res of subscribers) { try { res.write(payload); } catch (e) {} }
}, 1000);

// ---------------------------------------------------------------- http

const axCache = {};

const handler = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 1000\n\n');
    subscribers.add(res);
    req.on('close', () => subscribers.delete(res));
    return;
  }
  if (url.pathname === '/schema') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ channels: CHANNELS, sources, hz: FRAME_HZ, watch: WATCH_DIRS }, null, 2));
    return;
  }
  if (url.pathname === '/record') {
    const on = url.searchParams.get('on') !== '0';
    if (on && !recordStream) {
      const f = path.join(ROOT, 'record', new Date().toISOString().replace(/[:.]/g, '-') + '.ndjson');
      recordStream = fs.createWriteStream(f);
      res.end(JSON.stringify({ recording: true, file: f }));
    } else if (!on && recordStream) {
      const f = recordStream.path; recordStream.end(); recordStream = null;
      res.end(JSON.stringify({ recording: false, file: f }));
    } else res.end(JSON.stringify({ recording: !!recordStream }));
    return;
  }
  // ---- presets -----------------------------------------------------------
  // A named, saved patch. GET lists them, GET ?name= returns one, POST saves
  // one. Separate from the working patch so experimenting never costs you a
  // preset, and loading one never costs you what you were doing until you
  // save over it.
  if (url.pathname === '/presets') {
    const dir = path.join(ROOT, '..', 'm1-psyche', 'presets');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const safe = s => String(s).replace(/[^\w .\-]/g, '').slice(0, 60).trim();

    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 4e6) req.destroy(); });
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          const name = safe(j.name || '');
          if (!name) throw new Error('a preset needs a name');
          if (!j.graph || !Array.isArray(j.graph.nodes)) throw new Error('not a graph');
          fs.writeFileSync(path.join(dir, name + '.json'),
            JSON.stringify({ name, saved: new Date().toISOString(), graph: j.graph }, null, 1));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ saved: name, nodes: j.graph.nodes.length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
      return;
    }

    if (req.method === 'DELETE') {
      const name = safe(url.searchParams.get('name') || '');
      try { fs.unlinkSync(path.join(dir, name + '.json')); } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: name }));
      return;
    }

    const one = url.searchParams.get('name');
    if (one) {
      const f = path.join(dir, safe(one) + '.json');
      if (!fs.existsSync(f)) { res.writeHead(404); res.end('{"error":"no such preset"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      fs.createReadStream(f).pipe(res);
      return;
    }
    let list = [];
    try {
      list = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) {}
        return { name: f.replace(/\.json$/, ''), saved: meta.saved || null,
                 nodes: meta.graph && meta.graph.nodes ? meta.graph.nodes.length : 0 };
      }).sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ presets: list }));
    return;
  }

  // ---- live patch (not saved) -------------------------------------------
  // The patcher's own preview pane gets edits by postMessage, which only
  // reaches an iframe on the same page. Anything else showing the patch —
  // the floating panel, a second window, another Space — saw nothing until
  // you pressed save. This broadcasts an unsaved edit to every open client,
  // so the floating window becomes a true live preview.
  //
  // Nothing is written to disk: save still does that, and revert still
  // returns to the last saved state.
  if (url.pathname === '/live' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 4e6) req.destroy(); });
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        if (!j || !Array.isArray(j.nodes)) throw new Error('not a graph');
        const which = String(j.which || '/patch');
        const msg = 'event: live\ndata: ' + JSON.stringify({ which, graph: j }) + '\n\n';
        for (const r of subscribers) { try { r.write(msg); } catch (e) {} }
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ sent: subscribers.size ?? subscribers.length, nodes: j.nodes.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
      }
    });
    return;
  }

  // ---- accessibility snapshot -------------------------------------------
  // Runs the native reader and hands back its JSON. Cached briefly: a full
  // walk is an IPC round trip per attribute and costs tens to hundreds of
  // milliseconds, so re-running it every animation frame would be absurd.
  // The renderer re-fetches on its own schedule instead.
  if (url.pathname === '/ax') {
    const bin = path.join(ROOT, '..', 'm1-desktop', 'bin', 'ax-reader');
    if (!fs.existsSync(bin)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, trusted:false, elements:[],
        error:'ax-reader is not built. swiftc -O -o m1-desktop/bin/ax-reader '
            + 'm1-desktop/src/ax-reader.swift -framework AppKit' }));
      return;
    }
    const all = url.searchParams.get('all') === '1';
    const ttl = Math.max(0, +(url.searchParams.get('ttl') || 700));
    const key = all ? 'all' : 'front';
    const now = Date.now();
    if (axCache[key] && now - axCache[key].t < ttl) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(axCache[key].body);
      return;
    }
    const args = ['--max', String(Math.min(2000, +(url.searchParams.get('max') || 900))),
                  '--budget', String(Math.min(3000, +(url.searchParams.get('budget') || 900)))];
    if (all) args.push('--all');
    const p = spawn(bin, args);
    let buf = '', err = '';
    const kill = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 5000);
    p.stdout.on('data', d => { buf += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', () => {
      clearTimeout(kill);
      let body = buf.trim();
      if (!body) body = JSON.stringify({ ok:false, trusted:false, elements:[],
        error: err.trim() || 'ax-reader produced no output' });
      axCache[key] = { t: Date.now(), body };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
    });
    p.on('error', e => {
      clearTimeout(kill);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok:false, trusted:false, elements:[], error:String(e.message || e) }));
    });
    return;
  }

  // ---- directory tree --------------------------------------------------
  // The botanical view needs a hierarchy, and the point is that it is YOUR
  // hierarchy. Read-only, depth- and count-limited, and confined to the
  // directories the daemon already watches — so this exposes nothing that
  // the FSEvents watcher was not already looking at, and needs no new
  // permission. Names and sizes only; no file contents are ever read.
  if (url.pathname === '/tree') {
    const want = url.searchParams.get('path') || WATCH_DIRS[0];
    const maxDepth = Math.min(6, +(url.searchParams.get('depth') || 4));
    const maxNodes = Math.min(1200, +(url.searchParams.get('max') || 400));
    const root = path.resolve(want.replace(/^~/, os.homedir()));
    const allowed = WATCH_DIRS.map(d => path.resolve(d.replace(/^~/, os.homedir())));
    if (!allowed.some(a => root === a || root.startsWith(a + path.sep))) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'outside the watched directories', allowed }));
      return;
    }
    let n = 0;
    const walk = (dir, depth) => {
      const node = { name: path.basename(dir) || dir, dir: true, size: 0, kids: [] };
      if (depth > maxDepth || n >= maxNodes) return node;
      let items = [];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return node; }
      items.sort((a, b) => a.name.localeCompare(b.name));
      for (const it of items) {
        if (it.name.startsWith('.')) continue;          // no dotfiles
        if (n >= maxNodes) break;
        n++;
        const full = path.join(dir, it.name);
        if (it.isDirectory()) {
          const k = walk(full, depth + 1);
          node.kids.push(k);
          node.size += k.size;
        } else if (it.isFile()) {
          let sz = 0;
          try { sz = fs.statSync(full).size; } catch (_) {}
          node.kids.push({ name: it.name, dir: false, size: sz, kids: [] });
          node.size += sz;
        }
      }
      return node;
    };
    const tree = walk(root, 0);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ root, nodes: n, tree }));
    return;
  }

  // ---- self test -------------------------------------------------------
  // A page that can only run in a browser (anything touching WebGL) posts its
  // results here so they can be read from a terminal. Writes one JSON line to
  // selftest.log and nothing else; it holds no state and affects no output.
  if (url.pathname === '/selftest' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 2e5) req.destroy(); });
    req.on('end', () => {
      try {
        fs.appendFileSync(path.join(ROOT, 'selftest.log'),
                          JSON.stringify({ t: new Date().toISOString(), r: JSON.parse(body) }) + '\n');
      } catch (e) {}
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end('{"ok":true}');
    });
    return;
  }

  // ---- patch graph -----------------------------------------------------
  // The visualizer's signal routing lives in patch.json rather than in code.
  // Saving from the patcher broadcasts to every open client, so edits apply
  // to a running visualizer without a reload.
  if (url.pathname === '/patch' || url.pathname === '/m1/patch') {
    const pf = url.pathname === '/m1/patch'
      ? path.join(ROOT, '..', 'm1-psyche', 'psyche.json')
      : path.join(ROOT, 'patch.json');
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; if (body.length > 4e6) req.destroy(); });
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (!j || !Array.isArray(j.nodes)) throw new Error('not a graph');
          fs.writeFileSync(pf, JSON.stringify(j));
          const msg = 'event: patch\ndata: '
            + JSON.stringify({ nodes: j.nodes.length, t: Date.now(), which: url.pathname }) + '\n\n';
          for (const r of subscribers) { try { r.write(msg); } catch (e) {} }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ saved: true, nodes: j.nodes.length, edges: (j.edges || []).length }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(e.message || e) }));
        }
      });
      return;
    }
    if (!fs.existsSync(pf)) { res.writeHead(404); res.end('no patch saved'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    fs.createReadStream(pf).pipe(res);
    return;
  }

  // Two static roots. The Psychedelic OS lives in a sibling directory so the
  // two systems stay separable, and is served under /m1/ to keep the URL
  // namespaces from colliding.
  let base = ROOT, file;
  if (url.pathname.startsWith('/m1/')) {
    base = path.join(ROOT, '..', 'm1-psyche');
    file = url.pathname.slice(4) || 'psyche.html';
  } else if (url.pathname.startsWith('/m0-telemetry/')) {
    // An alias so the URL layout matches the layout on disk. A module in
    // m1-psyche/ imports '../m0-telemetry/patch/graph.js', which Node resolves
    // against the filesystem and the browser resolves against the URL — and
    // without this they disagree, so the shared engine loads in the tests and
    // 404s in the browser.
    file = url.pathname.slice('/m0-telemetry/'.length);
  } else {
    file = url.pathname === '/' ? 'scope.html' : url.pathname.replace(/^\//, '');
  }
  const full = path.join(base, file);
  const realBase = path.resolve(base);
  if (!path.resolve(full).startsWith(realBase) || !fs.existsSync(full)) {
    res.writeHead(404); res.end('not found'); return;
  }
  const ext = path.extname(full).toLowerCase();
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
                 '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
                 '.png': 'image/png' }[ext] || 'text/plain';
  // NO CACHING. This is a development tool served from localhost, and every
  // page is edited while it is open. Without these headers a browser caches
  // the modules heuristically and keeps running yesterday's code — which
  // looks exactly like a change that did not work, and wastes an afternoon
  // proving the server is fine. Revalidation on localhost is free.
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  fs.createReadStream(full).pipe(res);
};

// Loopback only, on BOTH families. Without a host Node listens on every
// interface, which offers this machine's CPU, disk, network and the paths of
// files being opened to anyone on the same wifi. Binding only 127.0.0.1 fixes
// that but breaks any IPv6-first client: Node's own fetch resolves `localhost`
// to ::1 and gets connection refused, which is a baffling failure to debug.
// Two servers sharing one handler keeps the machine private and `localhost`
// working whichever family resolves first.
const server = http.createServer(handler);
const server6 = http.createServer(handler);
server6.on('error', e => { if (e.code !== 'EADDRINUSE' && e.code !== 'EAFNOSUPPORT') throw e; });
server6.listen(PORT, '::1');

server.listen(PORT, '127.0.0.1', () => {
  if (!ARGS.stdout) {
    console.error('M0 telemetry daemon');
    console.error('  scope   http://localhost:' + PORT + '/');
    console.error('  stream  http://localhost:' + PORT + '/stream   (SSE)');
    console.error('  schema  http://localhost:' + PORT + '/schema');
    console.error('  ' + Object.keys(CHANNELS).length + ' channels @ ' + FRAME_HZ + ' Hz');
    console.error('  watching: ' + WATCH_DIRS.join(', '));
  }
});

function shutdown() {
  for (const c of children) { try { c.kill('SIGTERM'); } catch (e) {} }
  if (recordStream) recordStream.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
