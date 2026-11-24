// drawops.js — drawing as computation, and the motion generators.
//
// THE CLAIM. "Art as a new kind of computing" is usually a metaphor. These
// operators are the cases where it is not, because in each one the drawing is
// literally the operator's coefficients:
//
//   Drawn kernel    a hand-drawn impulse response, convolved with a live
//                   signal. Drawing a curve IS designing an FIR filter; the
//                   drawing is the coefficient vector, nothing more.
//   Drawn mask      a hand-painted frequency response. The drawing multiplies
//                   the STFT bins and the signal is resynthesised through it.
//                   This is the software form of the optical 4f correlator,
//                   where a mask placed in a lens's Fourier plane performs the
//                   filtering physically.
//   Drawn transfer  a hand-drawn nonlinearity. The drawing is the lookup
//                   table, the way a waveshaper's is.
//
// The lineage is old and it is not computer graphics: Daphne Oram's Oramics
// (1957) read control voltages off shapes drawn on 35mm film; Murzin's ANS
// read sound off a drawing scratched into glass; Xenakis's UPIC (1977) took a
// drawing as both score and timbre. In all three, the drawing is the data.
//
// THE MOTION GENERATORS are the other thing Scanimate needed and this patcher
// lacked. Its operators did not keyframe; they shaped an analogue ramp and let
// it drive everything. `gen.ramp` is that, with the ramp's shape drawn by hand.

import { num, sel, curve, fin, tick, makeCurve, curveAt, curveResample } from './opkit.js';
import { Ring, BandResynth } from './dsp.js';

const C = { draw:'#4f9e86', gen:'#6f8fb8' };

export const DRAW_OPS = {

// ---------------------------------------------------------------- transfer
// The drawing is the lookup table. Input maps across the curve left to right,
// the curve's height becomes the output. A straight diagonal is a no-op; bend
// it and you have a compressor, a gate, a gamma, or a shape no named function
// has. Nothing is approximated — the drawing is read directly.
'draw.transfer': { cat:'draw', title:'Drawn transfer', color:C.draw, w:214,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ curve('cv','in -> out', makeCurve('ramp')),
           num('il','in lo',0,-1e6,1e6), num('ih','in hi',1,-1e6,1e6),
           num('ol','out lo',0,-1e6,1e6), num('oh','out hi',1,-1e6,1e6) ],
  init:()=>({}),
  eval:(p,i)=>{
    const d = p.ih - p.il;
    const t = d === 0 ? 0 : (fin(i[0]) - p.il) / d;
    return [ p.ol + curveAt(p.cv, t) * (p.oh - p.ol) ]; } },

// ---------------------------------------------------------------- kernel
// A hand-drawn FIR filter. The curve is resampled to `len * rate` taps and
// convolved with the input. Tap 0 is the newest sample, so the curve reads
// left = now, right = `len` seconds ago.
//
// Normalised, the taps sum to 1, which makes it a weighted moving average: a
// flat drawing is a boxcar, a falling one is an exponential smoother, a hump
// is a raised-cosine, and a drawing with a bump at the right edge is an echo.
// Raw keeps your amplitudes, so the drawing can have gain.
'draw.kernel': { cat:'draw', title:'Drawn kernel (FIR)', color:C.draw, w:226,
  ins:[{k:'in'}], outs:[{k:'out'},{k:'sum',label:'tap sum'}],
  params:[ curve('cv','now -> past', makeCurve('decay')),
           num('len','length s',2,0.05,60,0.05), num('rate','analysis Hz',20,1,60,1),
           sel('norm','taps','unity',['unity','raw']),
           num('gain','gain',1,0,500,0.01) ],
  init:()=>({ring:null,k:null,sig:'',last:0,sum:0}),
  eval:(p,i,s,c)=>{
    const n = Math.max(2, Math.round(p.len * p.rate));
    // Rebuild only when the tap count or the drawing itself changed, so
    // scrubbing the gain does not throw away the signal history.
    const sig = n + '|' + p.norm + '|' + p.cv.join(',');
    if (s.sig !== sig) {
      if (!s.ring || s.ring.n !== n) s.ring = new Ring(n);
      const k = curveResample(p.cv, n);
      let sum = 0; for (let q = 0; q < n; q++) sum += k[q];
      if (p.norm === 'unity' && Math.abs(sum) > 1e-9) for (let q = 0; q < n; q++) k[q] /= sum;
      s.k = k; s.sum = sum; s.sig = sig;
    }
    const steps = tick(s, c, p.rate);
    for (let q = 0; q < steps; q++) s.ring.push(fin(i[0]));
    if (steps) {
      const a = s.ring.toArray(s.buf || (s.buf = new Float32Array(n)));
      let acc = 0;
      for (let j = 0; j < n; j++) acc += a[n - 1 - j] * s.k[j];   // tap 0 = newest
      s.last = acc * p.gain;
    }
    return [s.last, s.sum]; } },

// ---------------------------------------------------------------- mask
// A hand-painted frequency response. The curve spans 0 Hz on the left to
// `fmax` on the right; its height is that band's gain. The signal is taken to
// the frequency domain, multiplied by the drawing, and brought back by
// inverse STFT with overlap-add.
//
// Latency is about one window, so at the default 512 points and 10 Hz this
// output is roughly 50 s behind the input. That is a property of the method
// and not a bug: resolving a 0.1 Hz component requires having watched for 10 s.
'draw.mask': { cat:'draw', title:'Drawn spectral mask', color:C.draw, w:238,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ curve('cv','0 Hz -> fmax', makeCurve('fall')),
           sel('n','window','512',['256','512','1024','2048']),
           num('rate','analysis Hz',10,1,60,1),
           num('fmax','fmax Hz',1,0.01,30,0.01),
           num('gain','gain',1,0,100,0.01) ],
  init:()=>({br:null,n:0,rate:0,mask:null,sig:'',last:0}),
  eval:(p,i,s,c)=>{
    const n = +p.n;
    if (!s.br || s.n !== n || s.rate !== p.rate) {
      s.br = new BandResynth(n, p.rate); s.n = n; s.rate = p.rate; s.sig = '';
    }
    const half = (n >> 1) + 1;
    const sig = n + '|' + p.rate + '|' + p.fmax + '|' + p.cv.join(',');
    if (s.sig !== sig) {
      // bin k sits at k*rate/n Hz; read the drawing at that point
      const m = new Float32Array(half);
      for (let k = 0; k < half; k++) {
        m[k] = Math.max(0, curveAt(p.cv, (k * p.rate / n) / Math.max(1e-6, p.fmax)));
      }
      s.mask = m; s.sig = sig;
    }
    const steps = tick(s, c, p.rate);
    for (let q = 0; q < steps; q++) s.last = s.br.process(fin(i[0]), 0, 0, s.mask);
    return [s.last * p.gain]; } },

// ---------------------------------------------------------------- ramp
// Scanimate's motion generator, with the motion drawn by hand. It sweeps once
// per `period` and reads the drawing as its shape, so position over time is a
// curve you drew rather than a tween between keyframes.
//
// `trig` restarts the sweep on a rising edge, so a measured event can launch
// a move. In `once` mode it holds at the end until retriggered.
'gen.ramp': { cat:'gen', title:'Drawn ramp', color:C.gen, w:214,
  ins:[{k:'trig',label:'trigger'},{k:'per',label:'period'}], outs:[{k:'out'},{k:'ph',label:'phase'}],
  params:[ curve('cv','shape over time', makeCurve('ramp')),
           num('per','period s',4,0.02,600,0.02),
           sel('mode','mode','loop',['loop','once']),
           num('amp','depth',1,-100,100,0.01), num('off','offset',0,-100,100,0.01) ],
  init:()=>({ph:0,prev:null,done:false}),
  eval:(p,i,s,c)=>{
    const tr = fin(i[0]);
    // prev === null is the first evaluation. A trigger that happens to be HIGH
    // at that moment is not an edge: saving the patch re-runs init() on every
    // node, so treating it as one would retrigger every ramp on every save.
    if (s.prev !== null && tr > 0.5 && s.prev <= 0.5) { s.ph = 0; s.done = false; }
    s.prev = tr;
    const per = Math.max(0.02, i[1] == null ? p.per : Math.abs(fin(i[1])));
    if (!s.done) {
      s.ph += c.dt / per;
      if (s.ph >= 1) { if (p.mode === 'loop') s.ph %= 1; else { s.ph = 1; s.done = true; } }
    }
    return [ curveAt(p.cv, s.ph) * p.amp + p.off, s.ph ]; } },

// ---------------------------------------------------------------- S&H
// Freeze a value on a rising edge and hold it. This is what turns a continuous
// telemetry channel into a decision: sample the load at the moment a task
// starts, and hold that reading for the whole task.
'gen.sh': { cat:'gen', title:'Sample & hold', color:C.gen, w:196,
  ins:[{k:'in'},{k:'trig',label:'trigger'}], outs:[{k:'out'},{k:'age',label:'age s'}],
  params:[ num('thr','triggers above',0.5,-1e6,1e6), num('init','initial',0,-1e6,1e6) ],
  init:()=>({v:null,prev:null,age:0}),
  eval:(p,i,s,c)=>{
    if (s.v === null) s.v = p.init;
    const tr = fin(i[1]);
    if (s.prev !== null && tr > p.thr && s.prev <= p.thr) { s.v = fin(i[0]); s.age = 0; }
    else s.age += c.dt;
    s.prev = tr;
    return [s.v, s.age]; } },

// ---------------------------------------------------------------- sequencer
// Eight steps, advanced by a clock or by its own rate. The one operator here
// that is frankly authored rather than measured — it imposes a rhythm the
// machine does not have. Useful, and worth labelling as such in the RULES
// sheet when you wire it.
'gen.seq': { cat:'gen', title:'Step sequencer', color:C.gen, w:214,
  ins:[{k:'clk',label:'clock'}], outs:[{k:'out'},{k:'step',label:'step'}],
  params:[ num('s0','1',0.2,-10,10,0.01), num('s1','2',0.5,-10,10,0.01),
           num('s2','3',0.8,-10,10,0.01), num('s3','4',0.4,-10,10,0.01),
           num('s4','5',1.0,-10,10,0.01), num('s5','6',0.3,-10,10,0.01),
           num('s6','7',0.6,-10,10,0.01), num('s7','8',0.1,-10,10,0.01),
           num('n','steps',8,1,8,1), num('rate','free run Hz',1,0,20,0.01),
           sel('glide','glide','off',['off','on']), num('gt','glide s',0.15,0.001,5,0.005) ],
  init:()=>({k:0,prev:null,acc:0,v:0}),
  eval:(p,i,s,c)=>{
    const n = Math.max(1, Math.round(p.n));
    const steps = [p.s0,p.s1,p.s2,p.s3,p.s4,p.s5,p.s6,p.s7];
    let advance = false;
    if (i[0] != null) {                                  // external clock wins
      const clk = fin(i[0]);
      if (s.prev !== null && clk > 0.5 && s.prev <= 0.5) advance = true;
      s.prev = clk;
    } else if (p.rate > 0) {
      s.acc += c.dt;
      const per = 1 / p.rate;
      if (s.acc >= per) { s.acc -= per; advance = true; }
    }
    if (advance) s.k = (s.k + 1) % n;
    const target = steps[s.k % 8];
    if (p.glide === 'on') {
      const a = 1 - Math.exp(-c.dt / Math.max(0.001, p.gt));
      s.v += (target - s.v) * a;
    } else s.v = target;
    return [s.v, s.k]; } },

};

// ---------------------------------------------------------------- regimes
// Gray-Scott's character is set almost entirely by two numbers, and moving
// them by thousandths changes the organism completely. Pearson classified the
// space; these are the named regions worth living in.
//
// The `blend` input crossfades between two regimes, so a telemetry channel can
// walk the machine from branching coral to dividing cells. The space between
// two named points is continuous and mostly interesting, which is the reason
// this is an operator with an input and not a dropdown.
const REGIME = {
  coral:    [0.0545, 0.0620],
  mitosis:  [0.0367, 0.0649],
  worms:    [0.0580, 0.0650],
  solitons: [0.0300, 0.0620],
  waves:    [0.0140, 0.0540],
  uskate:   [0.0620, 0.0609],
};
const REGIME_NAMES = Object.keys(REGIME);

DRAW_OPS['rd.regime'] = {
  cat:'rd', title:'RD regime', color:'#8a7fb0', w:214,
  ins:[{k:'t',label:'blend'}],
  outs:[{k:'F',label:'feed F'},{k:'k',label:'kill k'}],
  params:[ sel('a','from','coral',REGIME_NAMES),
           sel('b','to','mitosis',REGIME_NAMES),
           num('t','blend',0,0,1,0.005) ],
  init:()=>({}),
  eval:(p,i)=>{
    const A = REGIME[p.a] || REGIME.coral, B = REGIME[p.b] || REGIME.mitosis;
    const t = Math.min(1, Math.max(0, i[0] == null ? p.t : fin(i[0])));
    return [ A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t ]; },
};

export const DRAW_CATS = [ ['draw','Drawing as computation'], ['rd','Reaction-diffusion'] ];
