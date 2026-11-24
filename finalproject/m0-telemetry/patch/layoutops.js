// layoutops.js — the desktop's furniture under signal control.
//
// Typography moves letters. These move the things letters sit on: windows,
// folder icons, the menu bar. Same arrangement — each operator pushes a
// modulator onto a stack and the renderer walks every SURFACE through it —
// so the two families are learned once and used twice.
//
// A SURFACE is a window, an icon, or the menu bar: a rectangle with a pivot
// at its centre. Transforming one carries its contents with it, so rotating a
// window rotates its title and its text, and the typography stack then runs
// inside that rotated space. Icons are their own surfaces rather than
// children of their window, which is the more useful choice here: it lets
// folders leave the window they live in.
//
// Precedent worth naming: Compiz's Wobbly Windows (2006) is the same idea —
// a compositing layer transforming whole windows as physical objects. The
// difference is that these transforms are driven by measured signals rather
// than by the mouse.

import { num, sel, fin } from './opkit.js';

const C = { lay:'#7fa8c7' };
const pk = (i, idx, p, k) => (i[idx] == null ? p[k] : fin(i[idx]));

// Same phase idea as typography, but the coordinates a surface has.
export const SURF_FROM = ['index', 'x', 'y', 'rand', 'none'];
export const SURF_TARGETS = ['all', 'window', 'icon', 'bar'];

const COMMON = (fromDef = 'index') => ([
  sel('from', 'phase from', fromDef, SURF_FROM),
  num('scale', 'phase scale', 1, -20, 20, 0.01),
  sel('target', 'applies to', 'all', SURF_TARGETS),
]);

const push = (c, m) => {
  if (c.layout) c.layout.push({ ...m, _y: c.node ? c.node.y : 0, _x: c.node ? c.node.x : 0 });
  return [];
};

export const LAYOUT_OPS = {

// ---------------------------------------------------------------- move
'lay.move': { cat:'layout', title:'Move surfaces', color:C.lay, w:214,
  ins:[{k:'amp',label:'amount'},{k:'f',label:'rate'}], outs:[],
  params:[ num('amp','amount px',24,-800,800,0.5),
           num('f','rate Hz',0.08,0,8,0.005),
           sel('axis','axis','y',['y','x','both']),
           sel('shape','shape','sine',['sine','tri','square','bounce']),
           ...COMMON('index') ],
  init:()=>({}),
  eval:(p,i,s,c)=>push(c,{ op:'move', amp:pk(i,0,p,'amp'), f:pk(i,1,p,'f'),
    axis:p.axis, shape:p.shape, from:p.from, scale:p.scale, target:p.target }) },

// ---------------------------------------------------------------- rotate
// About each surface's own centre, so a window turns in place rather than
// swinging around the screen.
'lay.rotate': { cat:'layout', title:'Rotate surfaces', color:C.lay, w:214,
  ins:[{k:'a',label:'degrees'}], outs:[],
  params:[ num('a','degrees',8,-360,360,0.1),
           num('f','spin Hz',0,-4,4,0.005),
           sel('mode','mode','phase',['phase','uniform','alternate','ramp']),
           ...COMMON('index') ],
  init:()=>({}),
  eval:(p,i,s,c)=>push(c,{ op:'rotate', a:pk(i,0,p,'a'), f:p.f, mode:p.mode,
    from:p.from, scale:p.scale, target:p.target }) },

// ---------------------------------------------------------------- scale
'lay.scale': { cat:'layout', title:'Scale surfaces', color:C.lay, w:214,
  ins:[{k:'s',label:'amount'}], outs:[],
  params:[ num('s','amount',0.15,-2,4,0.005),
           num('f','pulse Hz',0.1,0,8,0.005),
           num('base','base',1,0.05,4,0.005),
           sel('axis','axis','both',['both','x','y']),
           ...COMMON('index') ],
  init:()=>({}),
  eval:(p,i,s,c)=>push(c,{ op:'scale', s:pk(i,0,p,'s'), f:p.f, base:p.base,
    axis:p.axis, from:p.from, scale:p.scale, target:p.target }) },

// ---------------------------------------------------------------- tilt
// A shear, which reads as perspective without needing any. Driving kx from
// one channel and ky from another makes the desktop feel like a surface
// being leaned on rather than a picture being distorted.
'lay.tilt': { cat:'layout', title:'Tilt / shear', color:C.lay, w:214,
  ins:[{k:'kx',label:'kx'},{k:'ky',label:'ky'}], outs:[],
  params:[ num('kx','x by y',0.12,-2,2,0.005),
           num('ky','y by x',0,-2,2,0.005),
           num('f','rate Hz',0,0,8,0.005),
           ...COMMON('none') ],
  init:()=>({}),
  eval:(p,i,s,c)=>push(c,{ op:'tilt', kx:pk(i,0,p,'kx'), ky:pk(i,1,p,'ky'),
    f:p.f, from:p.from, scale:p.scale, target:p.target }) },

// ---------------------------------------------------------------- spiral
// Rotates each surface's POSITION about a point by an amount proportional to
// its distance from it, so the desktop winds up. Distinct from Rotate, which
// turns each surface where it stands.
'lay.spiral': { cat:'layout', title:'Spiral', color:C.lay, w:214,
  ins:[{k:'k',label:'amount'}], outs:[],
  params:[ num('k','turns per screen',0.25,-4,4,0.005),
           num('px','centre x',0.5,0,1,0.005), num('py','centre y',0.5,0,1,0.005),
           num('pull','pull inward',0,-1,1,0.005),
           sel('target','applies to','all',SURF_TARGETS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>push(c,{ op:'spiral', k:pk(i,0,p,'k'), px:p.px, py:p.py,
    pull:p.pull, target:p.target }) },

// ---------------------------------------------------------------- ring
// Lerps every surface from where it belongs to a position on a circle. At 0
// the desktop is exactly as laid out; at 1 it is a dial. Everything between
// is a real intermediate arrangement, which is the point of making it
// continuous rather than a mode.
'lay.ring': { cat:'layout', title:'Grid to ring', color:C.lay, w:214,
  ins:[{k:'amt',label:'amount'}], outs:[],
  params:[ num('amt','amount',0,0,1,0.005),
           num('r','radius',0.34,0,1.2,0.005),
           num('a','start turns',0,-2,2,0.005),
           num('px','centre x',0.5,0,1,0.005), num('py','centre y',0.5,0,1,0.005),
           sel('target','applies to','icon',SURF_TARGETS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>push(c,{ op:'ring', amt:pk(i,0,p,'amt'), r:p.r, a:p.a,
    px:p.px, py:p.py, target:p.target }) },

// ---------------------------------------------------------------- drift
// Seeded per-surface noise, stable frame to frame unless a rate is set — the
// same choice the typography Jitter makes, and for the same reason: a desktop
// that vibrates reads as broken, one that has drifted reads as alive.
'lay.drift': { cat:'layout', title:'Drift', color:C.lay, w:214,
  ins:[{k:'amt',label:'amount'}], outs:[],
  params:[ num('amt','amount px',18,0,600,0.5),
           num('rot','rotation deg',4,0,180,0.1),
           num('rate','reseed Hz',0,0,20,0.05),
           num('seed','seed',1,0,999,1),
           sel('target','applies to','all',SURF_TARGETS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>push(c,{ op:'drift', amt:pk(i,0,p,'amt'), rot:p.rot,
    rate:p.rate, seed:p.seed, target:p.target }) },

// ---------------------------------------------------------------- gravity
// Attract toward a point, or repel from it. Negative strength is an
// explosion; positive collapses the desktop into a pile.
'lay.gravity': { cat:'layout', title:'Gravity', color:C.lay, w:214,
  ins:[{k:'g',label:'strength'}], outs:[],
  params:[ num('g','strength',0,-2,2,0.005),
           num('px','toward x',0.5,0,1,0.005), num('py','toward y',0.5,0,1,0.005),
           sel('falloff','falloff','linear',['linear','inverse','constant']),
           sel('target','applies to','all',SURF_TARGETS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>push(c,{ op:'gravity', g:pk(i,0,p,'g'), px:p.px, py:p.py,
    falloff:p.falloff, target:p.target }) },

};

export const LAYOUT_CATS = [ ['layout','Layout & orientation'] ];
