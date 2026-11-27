// imageops.js — the picture itself, as something you can wire.
//
// Until now the image chain was a fixed pipeline — source, scan processor,
// chemistry, feedback, out — and a patch could only turn its knobs through
// named destinations (scan.amp, fb.gain, rd.mix). You could change how hard
// each stage pushed, never the order, never which stages ran, and there was
// nowhere to plug a new one in.
//
// An image wire fixes that. It carries a DESCRIPTION of a picture, not
// pixels: a plain spec tree, exactly like the shape wires, so the graph stays
// cheap to evaluate, survives JSON, and can be tested in Node with no canvas
// anywhere. The renderer compiles the tree once per frame and does the actual
// work.
//
//   Screen ──▶ Scan ──▶ Feedback ──▶ Colourise ──▶ Out
//                 └────▶ Blur ──────▶ Blend ──┘
//
// Adding an operator — an FFT, a DeepDream pass, a CNN filter — now means
// adding one entry here and one case in the renderer's evaluator, with
// nothing else touched.

import { num, sel, fin } from './opkit.js';

const C = { img: '#5f8fd0' };

export const IMG_IN  = { k:'img', label:'image', img:true };
export const IMG_OUT = { k:'img', label:'image', img:true };

export const image = (d, c) => ({ $:'image', d: (c && c.node) ? { ...d, id: c.node.id } : d });
export const isImage = v => !!(v && v.$ === 'image' && v.d);

// An unwired image input falls back to the source frame, so a half-built
// chain still shows you something instead of going black.
const SOURCE = { t:'source' };
const inImg = (i, idx) => (isImage(i[idx]) ? i[idx].d : SOURCE);
const pk = (i, idx, p, k) => (i[idx] == null ? p[k] : fin(i[idx]));

export const IMAGE_OPS = {

// ------------------------------------------------------------------ source
'img.source': { cat:'image', title:'Source frame', color:C.img, w:186,
  ins:[], outs:[IMG_OUT],
  params:[ sel('what','what','screen',['screen','black']) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ image(p.what === 'black' ? { t:'black' } : SOURCE, c) ] },

// -------------------------------------------------------------------- scan
// The Rutt/Etra scan processor: each row of the picture is deflected by its
// own brightness, which is what turns a flat image into a relief.
'img.scan': { cat:'image', title:'Scan process', color:C.img, w:226,
  ins:[IMG_IN, {k:'amp',label:'amplitude'}], outs:[IMG_OUT],
  params:[ num('amp','deflection px',40,0,200,0.5),
           num('persp','perspective',0.3,0,1,0.005),
           num('key','key threshold',0.08,0,1,0.005),
           num('rowStep','row spacing',1,1,8,1),
           num('density','density ref',0.055,0.004,0.5,0.001) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ image({ t:'scan', a:inImg(i,0),
    amp:pk(i,1,p,'amp'), persp:p.persp, key:p.key,
    rowStep:Math.round(p.rowStep), density:p.density }, c) ] },

// ---------------------------------------------------------------- feedback
// Each frame drawn over the last, slightly zoomed and turned. Everything
// that moves leaves a wake; nothing ever quite disappears.
'img.feedback': { cat:'image', title:'Feedback', color:C.img, w:226,
  ins:[IMG_IN, {k:'gain',label:'gain'}], outs:[IMG_OUT],
  params:[ num('gain','gain',0.94,0,0.999,0.001),
           num('zoom','zoom',1.002,0.98,1.02,0.0001),
           num('rot','rotation',0,-0.01,0.01,0.0001) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ image({ t:'feedback', a:inImg(i,0),
    gain:Math.min(0.999, Math.max(0, pk(i,1,p,'gain'))), zoom:p.zoom, rot:p.rot }, c) ] },

// ------------------------------------------------------- reaction-diffusion
'img.rd': { cat:'image', title:'Chemistry', color:C.img, w:226,
  ins:[IMG_IN, {k:'feed',label:'feed F'}, {k:'kill',label:'kill k'}], outs:[IMG_OUT],
  params:[ num('feed','feed F',0.0545,0.005,0.09,0.0005),
           num('kill','kill k',0.062,0.03,0.075,0.0005),
           num('iters','steps / frame',16,0,40,1),
           num('inject','seeding',1.2,0,3,0.01),
           num('gain','brightness',2.2,0,6,0.01),
           num('floor','floor',0.03,0,0.4,0.005),
           num('diffV','V diffusion',0.5,0.1,1,0.005) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ image({ t:'rd', a:inImg(i,0),
    feed:pk(i,1,p,'feed'), kill:pk(i,2,p,'kill'),
    iters:Math.round(p.iters), inject:p.inject, gain:p.gain,
    floor:p.floor, diffV:p.diffV }, c) ] },

// ------------------------------------------------------------------- blur
'img.blur': { cat:'image', title:'Blur', color:C.img, w:214,
  ins:[IMG_IN, {k:'r',label:'radius'}], outs:[IMG_OUT],
  params:[ num('r','radius px',6,0,80,0.5) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ image({ t:'blur', a:inImg(i,0), r:Math.max(0, pk(i,1,p,'r')) }, c) ] },

// ------------------------------------------------------------------ levels
// Brightness, contrast and a black floor, which is often all a picture needs
// before something else gets hold of it.
'img.levels': { cat:'image', title:'Levels', color:C.img, w:214,
  ins:[IMG_IN, {k:'gain',label:'gain'}], outs:[IMG_OUT],
  params:[ num('gain','gain',1,0,4,0.01),
           num('bias','brightness',0,-1,1,0.005),
           num('floor','black floor',0,0,0.5,0.005),
           num('gamma','gamma',1,0.1,4,0.01) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ image({ t:'levels', a:inImg(i,0),
    gain:pk(i,1,p,'gain'), bias:p.bias, floor:p.floor, gamma:p.gamma }, c) ] },

// --------------------------------------------------------------- colourise
// Maps brightness onto the colouriser a Gradient ramp or Luma keyer set up.
'img.colour': { cat:'image', title:'Colourise', color:C.img, w:214,
  ins:[IMG_IN, {k:'amt',label:'amount'}], outs:[IMG_OUT],
  params:[ num('amt','amount',1,0,1,0.01), num('key','key threshold',0.05,0,1,0.005) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ image({ t:'colour', a:inImg(i,0),
    amt:Math.min(1, Math.max(0, pk(i,1,p,'amt'))), key:p.key }, c) ] },

// ------------------------------------------------------------------- blend
'img.blend': { cat:'image', title:'Blend', color:C.img, w:226,
  ins:[{ ...IMG_IN, k:'a', label:'a' }, { ...IMG_IN, k:'b', label:'b' },
       { k:'t', label:'amount' }],
  outs:[IMG_OUT],
  params:[ num('t','amount',0.5,0,1,0.01),
           sel('mode','mode','mix',['mix','add','multiply','screen','difference']) ],
  init:()=>({}),
  eval:(p,i,s,c)=>[ image({ t:'blend', a:inImg(i,0), b:inImg(i,1),
    k:Math.min(1, Math.max(0, pk(i,2,p,'t'))), mode:p.mode }, c) ] },

// --------------------------------------------------------------------- out
// The end of an image chain. Everything upstream is a description until this
// hands it to the renderer.
'img.out': { cat:'image', title:'Image out', color:'#c7563f', w:214,
  ins:[IMG_IN, {k:'mix',label:'mix'}], outs:[],
  params:[ num('mix','mix with desktop',1,0,1,0.01) ],
  init:()=>({}),
  eval:(p,i,s,c)=>{
    if (c.out) c.out.$image = { d: inImg(i,0),
      mix: Math.min(1, Math.max(0, pk(i,1,p,'mix'))) };
    return []; } },

};

export const IMAGE_CATS = [ ['image','Image chain — the picture as blocks'] ];
