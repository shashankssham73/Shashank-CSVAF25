// ops.js — the operator library.
//
// An operator is a pure descriptor: ports, parameters, a state factory and an
// eval function. The graph engine owns scheduling; nothing here knows about
// the editor, and nothing here draws.
//
//   eval(p, i, s, c) -> array of output values
//     p  parameters (plain object)
//     i  input values (array, same order as `ins`; null when nothing is wired)
//     s  per-node state (from init())
//     c  context: { dt, t, raw, labels, rate }
//
// Analysis operators decimate to their own fixed sample rate rather than
// running at whatever frame rate the page happens to achieve. Otherwise a
// period measured on a 60 fps machine would read half as long on a 30 fps one.

import { Ring, spectrum, autocorrPeak, xcorrLag, makeKernel, convolveLatest,
         BandResynth, OnePole, OneEuro, Envelope, Slew, PeakHold, Pink } from './dsp.js';
import { num, sel, fin, tick } from './opkit.js';
import { SHAPE_OPS, SHAPE_CATS } from './shapeops.js';
import { DRAW_OPS, DRAW_CATS } from './drawops.js';
import { TEXT_OPS, TEXT_CATS } from './textops.js';
import { LAYOUT_OPS, LAYOUT_CATS } from './layoutops.js';
import { BOT_OPS, BOT_CATS } from './botops.js';
import { SELECT_OPS, SELECT_CATS, SEL_IN } from './selectops.js';
import { IMAGE_OPS, IMAGE_CATS } from './imageops.js';
import { READ_OPS, READ_CATS } from './readops.js';

export const CHANNELS = [
  'cpu.user_pct','cpu.sys_pct','cpu.idle_pct','cpu.busy_pct','load.1m',
  'disk.tps','disk.mb_per_s','disk.kb_per_tx',
  'vm.faults_per_s','vm.cow_per_s','vm.zerofill_per_s','vm.pageins_per_s','vm.pageouts_per_s',
  'vm.compress_per_s','vm.decompress_per_s','vm.free_mb','vm.active_mb','vm.wired_mb',
  'vm.compressor_mb','vm.compressed_logical_mb',
  'net.in_bytes_per_s','net.out_bytes_per_s','net.retx_per_s','net.dupe_per_s','net.ooo_per_s',
  'net.rtt_avg_ms','net.active_procs',
  'pwr.volts','pwr.amps','pwr.watts','pwr.batt_temp_c','pwr.charging',
  'fs.events',
  'in.pressure','in.stage','in.cursor_x','in.cursor_y','in.cursor_speed',
  'in.scroll_dy','in.scroll_dx','in.clicks','in.events','proc.top_cpu_pct',
];

export const BUS_IDS = ['net_in','net_out','disk_in','disk_out','fault','cow',
                        'pagein','pageout','compress','decomp','input','fsev'];

// Every sink the renderer exposes, with the range a graph value is expected in.
export const DESTS = [
  ['scan.amp',        0,   200,  'deflection amplitude (px)'],
  ['scan.persp',      0,   1,    'perspective depth'],
  ['scan.key',        0,   1,    'colouriser key threshold'],
  ['scan.skew',      -1,   1,    'raster tear'],
  ['scan.gainR',      0,   3,    'colouriser drive'],
  ['scan.rowStep',    1,   8,    'scanline spacing'],
  ['scan.floor',      0,   0.3,  'black floor'],
  // How dense a source this was tuned for. The stroke opacity is scaled by
  // refDensity/sourceDensity, so a screen capture does not wash out. Raise it
  // for a brighter image, lower it to pull a dense source back further.
  ['scan.density',    0.004, 0.5, 'source density reference'],
  ['fb.gain',         0.8, 0.995,'feedback gain'],
  ['fb.zoom',         0.999, 1.006, 'feedback zoom'],
  ['fb.rot',         -0.004, 0.004, 'feedback rotation'],
  ['hero.spawnRate',  0,   5,    'hero spawns / s'],
  ['hero.deathProb',  0,   1,    'hero loss probability'],
  ['particle.speed',  0,   3,    'particle speed multiplier'],
  ['type.warp',       0,   1,    'readout displacement'],
  // The Psychedelic OS's master control: crossfades the entire image pipeline
  // against the crisp, untouched desktop. 0 is a perfectly usable screen.
  ['chain.mix',       0,   1,    'crisp desktop <-> processed'],
  // Reaction-diffusion. rd.mix crossfades the whole stage against the scan
  // processor, so 0 is exactly today's image and 1 is pure chemistry.
  ['rd.mix',          0,   1,    'scanlines <-> chemistry'],
  ['rd.feed',         0.005, 0.09, 'Gray-Scott feed rate F'],
  ['rd.kill',         0.03,  0.075,'Gray-Scott kill rate k'],
  ['rd.inject',       0,   3,    'how hard traffic seeds the chemistry'],
  ['rd.iters',        0,   40,   'simulation steps per frame'],
  // Applied PER ITERATION, so it compounds by rd.iters every frame: 0.004 at
  // 16 iterations kills a pattern in under a second. Gray-Scott already has
  // its own removal term (F+k); this is extra starvation, and 0 is usually right.
  ['rd.decay',        0,   0.01, 'extra starvation, per iteration — use sparingly'],
  ['rd.gain',         0,   6,    'output brightness'],
  ['rd.floor',        0,   0.4,  'below this the chemistry is invisible'],
  ['rd.diffV',        0.1, 1.0,  'V diffusion (asymmetry drives the pattern)'],
  ...BUS_IDS.map(b => [`bus.${b}`, 0, 1.6, `${b} emission level`]),
];

// `tick`, `num`, `sel` and `fin` now live in opkit.js so the shape and drawing
// operator files can share them without importing this one in a circle.

const CORE_OPS = {

// ---------------------------------------------------------------- sources
channel: { cat:'source', title:'Channel', color:'#4aa3c7', w:186,
  ins:[], outs:[{k:'v',label:'value'}],
  params:[ sel('ch','channel','cpu.busy_pct',CHANNELS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ fin(c.raw[p.ch]) ] },

const: { cat:'source', title:'Constant', color:'#4aa3c7', w:140,
  ins:[], outs:[{k:'v',label:'value'}],
  params:[ num('v','value',1,-1000,1000) ],
  init:()=>({}), eval:(p)=>[p.v] },

time: { cat:'source', title:'Time', color:'#4aa3c7', w:130,
  ins:[], outs:[{k:'t',label:'seconds'}],
  params:[], init:()=>({}), eval:(p,i,s,c)=>[c.t] },

// ---------------------------------------------------------------- math
scale: { cat:'math', title:'Scale', color:'#7f8fa0', w:150,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('mul','x',1,-50,50), num('add','+',0,-100,100) ],
  init:()=>({}), eval:(p,i)=>[ fin(i[0])*p.mul + p.add ] },

curve: { cat:'math', title:'Curve', color:'#7f8fa0', w:160,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ sel('mode','mode','log1p',['log1p','pow','exp','sqrt','sigmoid']),
           num('k','amount',1,0.05,10) ],
  init:()=>({}),
  eval:(p,i)=>{ const x=fin(i[0]);
    switch(p.mode){
      case 'pow':   return [Math.sign(x)*Math.pow(Math.abs(x),p.k)];
      case 'exp':   return [Math.expm1(x*p.k)];
      case 'sqrt':  return [Math.sign(x)*Math.sqrt(Math.abs(x))*p.k];
      case 'sigmoid': return [1/(1+Math.exp(-x*p.k))];
      default:      return [Math.log1p(Math.max(0,x))*p.k];
    } } },

// log1p(v)/log1p(ref) with a decaying peak tracker on ref. This is the single
// most used conditioning step in the project: telemetry is heavy-tailed and a
// fixed reference is wrong on every machine but the one it was tuned on.
norm: { cat:'math', title:'Normalise', color:'#7f8fa0', w:186,
  ins:[{k:'in'}], outs:[{k:'out',label:'0..1'},{k:'ref',label:'ref'}],
  params:[ num('ref','seed ref',100,0.001,5e6,0.001), num('decay','peak decay',0.9985,0.9,1,0.0001),
           sel('track','adapt','on',['on','off']) ],
  init:()=>({peak:0}),
  eval:(p,i,s)=>{ const x=Math.max(0,fin(i[0]));
    let ref=p.ref;
    if(p.track==='on'){ s.peak=Math.max(x, s.peak*p.decay, p.ref*0.25); ref=s.peak; }
    const n = ref>0 ? Math.log1p(x)/Math.log1p(ref) : 0;
    return [Math.min(1.6,Math.max(0,n)), ref]; } },

clamp: { cat:'math', title:'Clamp', color:'#7f8fa0', w:150,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('lo','min',0,-1000,1000), num('hi','max',1,-1000,1000) ],
  init:()=>({}), eval:(p,i)=>[Math.min(p.hi,Math.max(p.lo,fin(i[0])))] },

remap: { cat:'math', title:'Remap', color:'#7f8fa0', w:172,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('il','in lo',0,-1e6,1e6), num('ih','in hi',1,-1e6,1e6),
           num('ol','out lo',0,-1e6,1e6), num('oh','out hi',1,-1e6,1e6),
           sel('cl','clamp','on',['on','off']) ],
  init:()=>({}),
  eval:(p,i)=>{ const d=p.ih-p.il; let t = d===0 ? 0 : (fin(i[0])-p.il)/d;
    if(p.cl==='on') t=Math.min(1,Math.max(0,t));
    return [p.ol + t*(p.oh-p.ol)]; } },

abs: { cat:'math', title:'Abs', color:'#7f8fa0', w:120,
  ins:[{k:'in'}], outs:[{k:'out'}], params:[], init:()=>({}),
  eval:(p,i)=>[Math.abs(fin(i[0]))] },

invert: { cat:'math', title:'Invert', color:'#7f8fa0', w:130,
  ins:[{k:'in'}], outs:[{k:'out'}], params:[], init:()=>({}),
  eval:(p,i)=>[1-fin(i[0])] },

// ---------------------------------------------------------------- combine
math2: { cat:'combine', title:'Math', color:'#8a7fb0', w:160,
  ins:[{k:'a'},{k:'b'}], outs:[{k:'out'}],
  params:[ sel('mode','op','add',['add','sub','mul','div','min','max','pow']) ],
  init:()=>({}),
  eval:(p,i)=>{ const a=fin(i[0]), b=fin(i[1]);
    switch(p.mode){ case 'sub':return[a-b]; case 'mul':return[a*b];
      case 'div':return[Math.abs(b)<1e-9?0:a/b]; case 'min':return[Math.min(a,b)];
      case 'max':return[Math.max(a,b)]; case 'pow':return[Math.pow(Math.abs(a),b)];
      default:return[a+b]; } } },

mix: { cat:'combine', title:'Mix', color:'#8a7fb0', w:160,
  ins:[{k:'a'},{k:'b'},{k:'t'}], outs:[{k:'out'}],
  params:[ num('t','t (no input)',0.5,0,1) ],
  init:()=>({}),
  eval:(p,i)=>{ const t=Math.min(1,Math.max(0,i[2]==null?p.t:fin(i[2])));
    return [fin(i[0])*(1-t)+fin(i[1])*t]; } },

// ---------------------------------------------------------------- filters
lowpass: { cat:'filter', title:'Low pass', color:'#4f9e86', w:170,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('cut','cutoff Hz',2,0.01,30,0.01) ],
  init:()=>({f:new OnePole()}),
  eval:(p,i,s,c)=>[s.f.process(fin(i[0]),p.cut,c.dt)] },

oneeuro: { cat:'filter', title:'One euro', color:'#4f9e86', w:180,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('cut','min cutoff',1,0.01,20,0.01), num('beta','beta',0.02,0,2,0.001) ],
  init:()=>({f:new OneEuro()}),
  eval:(p,i,s,c)=>[s.f.process(fin(i[0]),p.cut,p.beta,c.dt)] },

envelope: { cat:'filter', title:'Envelope', color:'#4f9e86', w:180,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('a','attack ms',40,0,5000,1), num('r','release ms',600,0,20000,1) ],
  init:()=>({f:new Envelope()}),
  eval:(p,i,s,c)=>[s.f.process(fin(i[0]),p.a,p.r,c.dt)] },

slew: { cat:'filter', title:'Slew limit', color:'#4f9e86', w:170,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('rate','max /s',1,0.001,500,0.001) ],
  init:()=>({f:new Slew()}),
  eval:(p,i,s,c)=>[s.f.process(fin(i[0]),p.rate,c.dt)] },

peakhold: { cat:'filter', title:'Peak hold', color:'#4f9e86', w:170,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('d','decay /s',0.5,0,100,0.01) ],
  init:()=>({f:new PeakHold()}),
  eval:(p,i,s,c)=>[s.f.process(fin(i[0]),p.d,c.dt)] },

// ---------------------------------------------------------------- dsp
autocorr: { cat:'dsp', title:'Autocorrelation', color:'#c08a3e', w:214,
  ins:[{k:'in'}], outs:[{k:'period',label:'period s'},{k:'r',label:'strength'},{k:'bpm',label:'per min'}],
  params:[ num('win','window s',30,4,120,1), num('rate','analysis Hz',10,1,60,1),
           num('lo','min period s',0.4,0.05,30,0.05), num('hi','max period s',15,0.2,60,0.1) ],
  init:()=>({ring:null,res:{period:0,strength:0},n:0}),
  eval:(p,i,s,c)=>{
    const n = Math.max(32, Math.round(p.win*p.rate));
    if(!s.ring || s.n!==n){ s.ring=new Ring(n); s.n=n; }
    const k=tick(s,c,p.rate);
    for(let q=0;q<k;q++) s.ring.push(fin(i[0]));
    if(k && s.ring.filled>n*0.6){
      s.cool=(s.cool||0)+1;
      if(s.cool>=4){ s.cool=0; s.res=autocorrPeak(s.ring.toArray(),p.rate,p.lo,p.hi); }
    }
    return [s.res.period, s.res.strength, s.res.period>0?60/s.res.period:0]; } },

spectrum: { cat:'dsp', title:'Spectrum', color:'#c08a3e', w:214,
  ins:[{k:'in'}], outs:[{k:'c',label:'centroid Hz'},{k:'f',label:'flatness'},
                        {k:'b',label:'band'},{k:'pf',label:'peak Hz'}],
  params:[ sel('n','window','256',['64','128','256','512','1024']),
           num('rate','analysis Hz',30,1,60,1),
           num('lo','band lo Hz',0.1,0,30,0.01), num('hi','band hi Hz',1,0.01,30,0.01) ],
  init:()=>({ring:null,n:0,res:{centroid:0,flatness:0,bandNorm:0,peakFreq:0}}),
  eval:(p,i,s,c)=>{
    const n=+p.n;
    if(!s.ring || s.n!==n){ s.ring=new Ring(n); s.n=n; }
    const k=tick(s,c,p.rate);
    for(let q=0;q<k;q++) s.ring.push(fin(i[0]));
    if(k && s.ring.filled>=n){
      s.cool=(s.cool||0)+1;
      if(s.cool>=4){ s.cool=0; s.res=spectrum(s.ring.toArray(),p.rate,p.lo,p.hi); }
    }
    return [s.res.centroid,s.res.flatness,s.res.bandNorm,s.res.peakFreq]; } },

// STFT -> zero every bin outside the band -> iFFT -> overlap-add.
// Latency is about one window, so a 0.1-0.3 Hz band is roughly 20 s late.
// That is fine for a breathing envelope and wrong for anything responsive.
bandresynth: { cat:'dsp', title:'Band resynth (iSTFT)', color:'#c08a3e', w:226,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ sel('n','window','512',['256','512','1024','2048']),
           num('rate','analysis Hz',10,1,60,1),
           num('lo','lo Hz',0.1,0,30,0.001), num('hi','hi Hz',0.3,0.001,30,0.001) ],
  init:()=>({br:null,n:0,rate:0,last:0}),
  eval:(p,i,s,c)=>{
    const n=+p.n;
    if(!s.br || s.n!==n || s.rate!==p.rate){ s.br=new BandResynth(n,p.rate); s.n=n; s.rate=p.rate; }
    const k=tick(s,c,p.rate);
    for(let q=0;q<k;q++) s.last=s.br.process(fin(i[0]),p.lo,p.hi);
    return [s.last]; } },

convolve: { cat:'dsp', title:'Convolve', color:'#c08a3e', w:200,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ sel('kind','kernel','exp',['exp','box','tri','raised']),
           num('len','length s',1.5,0.05,30,0.05), num('rate','analysis Hz',30,1,60,1),
           num('gain','gain',1,0,200,0.1) ],
  init:()=>({ring:null,k:null,n:0,sig:'',last:0}),
  eval:(p,i,s,c)=>{
    const n=Math.max(2,Math.round(p.len*p.rate)), sig=p.kind+n;
    if(s.sig!==sig){ s.ring=new Ring(n); s.k=makeKernel(p.kind,n); s.sig=sig; }
    const k=tick(s,c,p.rate);
    for(let q=0;q<k;q++) s.ring.push(fin(i[0]));
    if(k) s.last=convolveLatest(s.ring.toArray(),s.k)*p.gain;
    return [s.last]; } },

xcorr: { cat:'dsp', title:'Cross-correlation', color:'#c08a3e', w:226,
  ins:[{k:'a'},{k:'b'}], outs:[{k:'lag',label:'lag s'},{k:'r',label:'r'},{k:'lead',label:'a leads'}],
  params:[ num('win','window s',30,4,120,1), num('rate','analysis Hz',10,1,60,1),
           num('max','max lag s',5,0.2,30,0.1) ],
  init:()=>({a:null,b:null,n:0,res:{lag:0,r:0}}),
  eval:(p,i,s,c)=>{
    const n=Math.max(32,Math.round(p.win*p.rate));
    if(!s.a || s.n!==n){ s.a=new Ring(n); s.b=new Ring(n); s.n=n; }
    const k=tick(s,c,p.rate);
    for(let q=0;q<k;q++){ s.a.push(fin(i[0])); s.b.push(fin(i[1])); }
    if(k && s.a.filled>n*0.6){
      s.cool=(s.cool||0)+1;
      if(s.cool>=4){ s.cool=0; s.res=xcorrLag(s.a.toArray(),s.b.toArray(),p.rate,p.max); }
    }
    return [s.res.lag, s.res.r, s.res.lag>0?1:0]; } },

// ---------------------------------------------------------------- logic
threshold: { cat:'logic', title:'Threshold', color:'#b06a6a', w:186,
  ins:[{k:'in'}], outs:[{k:'out',label:'0/1'}],
  params:[ num('lvl','level',0.5,-1e6,1e6), num('hys','hysteresis',0.05,0,1e6) ],
  init:()=>({on:false}),
  eval:(p,i,s)=>{ const x=fin(i[0]);
    if(s.on && x < p.lvl-p.hys) s.on=false;
    else if(!s.on && x > p.lvl+p.hys) s.on=true;
    return [s.on?1:0]; } },

gate: { cat:'logic', title:'Gate', color:'#b06a6a', w:160,
  ins:[{k:'in'},{k:'open'}], outs:[{k:'out'}],
  params:[ num('thr','opens above',0.5,-1e6,1e6) ],
  init:()=>({}),
  eval:(p,i)=>[ fin(i[1])>p.thr ? fin(i[0]) : 0 ] },

select: { cat:'logic', title:'Select', color:'#b06a6a', w:170,
  ins:[{k:'a'},{k:'b'},{k:'pick'}], outs:[{k:'out'}],
  params:[ num('thr','b above',0.5,-1e6,1e6) ],
  init:()=>({}),
  eval:(p,i)=>[ fin(i[2])>p.thr ? fin(i[1]) : fin(i[0]) ] },

compare: { cat:'logic', title:'Compare', color:'#b06a6a', w:170,
  ins:[{k:'a'},{k:'b'}], outs:[{k:'out',label:'0/1'}],
  params:[ sel('mode','test','>',['>','>=','<','<=']) ],
  init:()=>({}),
  eval:(p,i)=>{ const a=fin(i[0]),b=fin(i[1]);
    return [ (p.mode==='>'?a>b:p.mode==='>='?a>=b:p.mode==='<'?a<b:a<=b) ? 1:0 ]; } },

// ---------------------------------------------------------------- generators
lfo: { cat:'gen', title:'LFO', color:'#6f8fb8', w:186,
  ins:[{k:'fm',label:'freq +'}], outs:[{k:'out'}],
  params:[ num('f','Hz',0.2,0.001,20,0.001), sel('shape','shape','sine',['sine','tri','saw','square']),
           num('amp','depth',1,0,100), num('off','offset',0,-100,100) ],
  init:()=>({ph:0}),
  eval:(p,i,s,c)=>{
    s.ph = (s.ph + (p.f + fin(i[0]))*c.dt) % 1;
    if(s.ph<0) s.ph+=1;
    const x = p.shape==='tri'   ? 1-4*Math.abs(s.ph-0.5)
            : p.shape==='saw'   ? s.ph*2-1
            : p.shape==='square'? (s.ph<0.5?1:-1)
            :                     Math.sin(2*Math.PI*s.ph);
    return [x*p.amp + p.off]; } },

pink: { cat:'gen', title:'1/f noise', color:'#6f8fb8', w:180,
  ins:[], outs:[{k:'out'}],
  params:[ num('amp','depth',1,0,100), num('off','offset',0,-100,100),
           num('rate','update Hz',20,0.5,60,0.5) ],
  init:()=>({p:new Pink(),v:0}),
  eval:(p,i,s,c)=>{ const k=tick(s,c,p.rate); for(let q=0;q<k;q++) s.v=s.p.next();
    return [s.v*p.amp + p.off]; } },

// ---------------------------------------------------------------- utility
scope: { cat:'util', title:'Scope', color:'#8c8c8c', w:214, scope:true,
  ins:[{k:'in'}], outs:[{k:'out'}],
  params:[ num('span','history s',12,1,120,1) ],
  init:()=>({hist:new Float32Array(240),i:0,lo:0,hi:1}),
  eval:(p,i,s,c)=>{ const v=fin(i[0]);
    s.acc=(s.acc||0)+c.dt;
    const step=p.span/240;
    if(s.acc>=step){ s.acc-=step; s.hist[s.i]=v; s.i=(s.i+1)%240; }
    s.v=v; return [v]; } },

out: { cat:'out', title:'Output', color:'#c7563f', w:226,
  ins:[{k:'in'}], outs:[],
  params:[ sel('dest','destination','scan.amp',DESTS.map(d=>d[0])),
           sel('mode','write','set',['set','add','multiply']) ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ const v=fin(i[0]);
    const prev = c.out[p.dest];
    c.out[p.dest] = p.mode==='add' ? (prev==null?0:prev)+v
                  : p.mode==='multiply' ? (prev==null?1:prev)*v
                  : v;
    return []; } },
};

// The full library. Shape, drawing and generator operators are defined in
// their own files and merged here, so this file stays the place where the
// SIGNAL operators live and the palette order stays explicit.
// Every effect gains a `selection` input, appended LAST so existing patches
// keep their input indices. Done by wrapping rather than by editing eighteen
// operators, so an effect added later gets it automatically and the two
// cannot drift apart.
//
// Wired, the selection decides which elements the effect touches. Unwired,
// the effect falls back to its own `applies to` dropdown — so a simple patch
// stays simple and nothing that already worked stops working.
function withSelection(ops) {
  const out = {};
  for (const [k, o] of Object.entries(ops)) {
    const si = o.ins.length;
    out[k] = {
      ...o,
      ins: [...o.ins, SEL_IN],
      eval: (p, i, s, c) => {
        const nt = c.text ? c.text.length : 0;
        const nl = c.layout ? c.layout.length : 0;
        const r = o.eval(p, i, s, c);
        const v = i[si];
        if (v && v.$ === 'sel') {
          if (c.text && c.text.length > nt) c.text[c.text.length - 1].match = v.m;
          if (c.layout && c.layout.length > nl) c.layout[c.layout.length - 1].match = v.m;
        }
        return r;
      },
    };
  }
  return out;
}

export const OPS = { ...CORE_OPS, ...SHAPE_OPS, ...DRAW_OPS, ...READ_OPS, ...SELECT_OPS,
                     ...IMAGE_OPS,
                     ...withSelection(TEXT_OPS), ...withSelection(LAYOUT_OPS),
                     ...BOT_OPS };

export const CATS = [
  ...READ_CATS, ...SELECT_CATS, ...IMAGE_CATS,
  ['source','Sources'], ['math','Math & shaping'], ['combine','Combine'],
  ['filter','Filters & envelopes'], ['dsp','DSP'],
  ...DRAW_CATS,
  ['logic','Logic'], ['gen','Generators'],
  ...SHAPE_CATS,
  ...TEXT_CATS,
  ...LAYOUT_CATS,
  ...BOT_CATS,
  ['util','Utility'], ['out','Output'],
];
