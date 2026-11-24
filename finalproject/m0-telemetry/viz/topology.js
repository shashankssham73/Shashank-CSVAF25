// The machine map. Node positions are fixed forever so the geography is
// learnable: the disk is always bottom-left, memory is always upper-right.
// Coordinates are normalised 0..1 and scaled to the canvas at draw time.
//
// Every bus names the real telemetry channel that drives it. A bus with no
// channel is drawn dead, because the counter behind it needs root (GPU and ANE
// power come from IOReport / powermetrics, which this daemon deliberately does
// not use). Showing the hole is more honest than hiding it.

export const NODES = {
  cpu:      { x: 0.500, y: 0.520, r: 0.082, label: 'CPU',        sub: 'scheduler' },
  ram:      { x: 0.775, y: 0.295, r: 0.058, label: 'RAM',        sub: 'resident' },
  comp:     { x: 0.775, y: 0.740, r: 0.048, label: 'COMPRESSOR', sub: 'swap' },
  disk:     { x: 0.225, y: 0.740, r: 0.058, label: 'DISK',       sub: 'nvme' },
  net:      { x: 0.225, y: 0.295, r: 0.054, label: 'NET',        sub: 'tcp' },
  user:     { x: 0.500, y: 0.115, r: 0.042, label: 'USER',       sub: 'input' },
  fs:       { x: 0.068, y: 0.520, r: 0.038, label: 'FS',         sub: 'fsevents' },
  gpu:      { x: 0.932, y: 0.520, r: 0.048, label: 'GPU',        sub: 'no counter', dead: true },
};

// ref = the value that should saturate the bus. Seeded from measured idle/busy
// ranges on this machine, then raised at runtime by a decaying peak tracker so
// an unusually heavy task still fits on screen.
export const BUSES = [
  { id: 'net_in',   from: 'net',  to: 'cpu',  ch: 'net.in_bytes_per_s',   ref: 2.0e6, bow:  0.06 },
  { id: 'net_out',  from: 'cpu',  to: 'net',  ch: 'net.out_bytes_per_s',  ref: 1.0e6, bow: -0.06 },
  { id: 'disk_in',  from: 'disk', to: 'cpu',  ch: 'disk.mb_per_s',        ref: 180,   bow: -0.06 },
  { id: 'disk_out', from: 'cpu',  to: 'disk', ch: 'disk.tps',             ref: 2500,  bow:  0.06 },
  { id: 'fault',    from: 'ram',  to: 'cpu',  ch: 'vm.faults_per_s',      ref: 2.0e5, bow:  0.05 },
  { id: 'cow',      from: 'cpu',  to: 'ram',  ch: 'vm.cow_per_s',         ref: 2.0e4, bow: -0.05 },
  { id: 'pagein',   from: 'disk', to: 'ram',  ch: 'vm.pageins_per_s',     ref: 1500,  bow:  0.26 },
  { id: 'pageout',  from: 'ram',  to: 'disk', ch: 'vm.pageouts_per_s',    ref: 1200,  bow:  0.26, warn: true },
  { id: 'compress', from: 'ram',  to: 'comp', ch: 'vm.compress_per_s',    ref: 6000,  bow:  0.05, warn: true },
  { id: 'decomp',   from: 'comp', to: 'ram',  ch: 'vm.decompress_per_s',  ref: 6000,  bow: -0.05 },
  { id: 'input',    from: 'user', to: 'cpu',  ch: 'in.events',            ref: 50,    bow:  0.00 },
  { id: 'fsev',     from: 'fs',   to: 'disk', ch: 'fs.events',            ref: 12,    bow:  0.10 },
  { id: 'render',   from: 'cpu',  to: 'gpu',  ch: null,                   ref: 1,     bow:  0.00, dead: true },
];

// Amber overlays: these ride the same geometry as an existing bus but mean
// trouble. Kept separate so the colour stays meaningful.
export const FAULTS = [
  { bus: 'net_in',  ch: 'net.retx_per_s', ref: 20 },
  { bus: 'net_in',  ch: 'net.ooo_per_s',  ref: 40 },
  { bus: 'net_in',  ch: 'net.dupe_per_s', ref: 20 },
];

// A hero's route through the machine. One real file, followed end to end.
// This is the journey: it starts as a filesystem event, is read from disk,
// is worked on by the CPU, occupies memory, and is written back out.
export const HERO_ROUTE = ['fs', 'disk', 'cpu', 'ram', 'cpu', 'disk'];

// ---------------------------------------------------------------- scaling

// Telemetry is heavy-tailed: idle is near zero and a burst is five orders of
// magnitude up. log1p keeps the quiet end visible instead of flat.
export function norm(v, ref) {
  if (!(v > 0) || !(ref > 0)) return 0;
  const n = Math.log1p(v) / Math.log1p(ref);
  return n < 0 ? 0 : n > 1.6 ? 1.6 : n;      // allow overshoot, clamp the absurd
}

// Decaying peak tracker, so refs adapt to the machine without a calibration step.
export class Peak {
  constructor(decay = 0.9985) { this.decay = decay; this.v = new Map(); }
  push(k, x, seed) {
    const cur = this.v.get(k) ?? seed;
    this.v.set(k, Math.max(x, cur * this.decay, seed * 0.25));
    return this.v.get(k);
  }
}

// ---------------------------------------------------------------- the acts

// Rough phase classification. This is the storytelling layer: it names which
// act the current task is in, from which subsystem actually dominates. It is
// deliberately simple and deliberately honest about being a guess.
export function phaseOf(ch) {
  const cpu  = ch['cpu.busy_pct']        || 0;
  const disk = ch['disk.mb_per_s']       || 0;
  const tps  = ch['disk.tps']            || 0;
  const fsev = ch['fs.events']           || 0;
  const cmp  = ch['vm.compress_per_s']   || 0;
  const net  = (ch['net.in_bytes_per_s'] || 0) + (ch['net.out_bytes_per_s'] || 0);
  const pout = ch['vm.pageouts_per_s']   || 0;

  if (pout > 400 || cmp > 3000)            return { key: 'ordeal',  name: 'ORDEAL',    why: 'memory pressure' };
  if (cpu > 55 && disk < 20)               return { key: 'trial',   name: 'TRIAL',     why: 'compute bound' };
  if (disk > 25 || tps > 600)              return { key: 'return',  name: 'RETURN',    why: 'writing out' };
  if (fsev > 2 || tps > 120)               return { key: 'call',    name: 'THE CALL',  why: 'files moving' };
  if (net > 4.0e5)                         return { key: 'journey', name: 'CROSSING',  why: 'network' };
  if (cpu > 18)                            return { key: 'road',    name: 'THE ROAD',  why: 'background work' };
  return { key: 'idle', name: 'ORDINARY WORLD', why: 'idle' };
}
