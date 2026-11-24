// readops.js — HOW the patcher reads the screen.
//
// Pick blocks answer "which elements". These answer the question underneath
// it: what counts as an element in the first place.
//
// Until now there was one answer, and it was never stated: the Accessibility
// API, which returns what applications declare. That is exact and semantic,
// and it is blind to everything that is not a control — a photograph, a
// video, a gradient, a canvas, a game. For a system that is supposed to
// affect anything you can see, one way of looking is not enough.
//
//   Read elements   what the applications say is there    exact, semantic
//   Read grid       fixed tiles, each measured            uniform, predictable
//   Read regions    tiles merged until something coheres  follows the content
//
// Each one outputs a SELECTION of what it found, so a reader wires straight
// into an effect, or through Pick blocks first:
//
//   Read grid --> [selection] --> Pick by range (bright 0.6..1) --> Scale
//
// EVERY READER HAS AN AREA. x, y, width and height in 0..1 of the screen, so
// a reader can be pointed at a strip, a corner, or one half. That is the
// "custom size and shape" case: a fine grid over the menu bar and a coarse
// one everywhere else is two readers with different areas.

import { num, sel as selp, fin } from './opkit.js';
import { sel } from './selection.js';
import { SEL_OUT } from './selectops.js';

const C = { read: '#5aa0b8' };
const pk = (i, idx, p, k) => (i[idx] == null ? p[k] : fin(i[idx]));

// Every reader takes the same four, and they mean the same thing each time.
const AREA = [
  num('ax', 'area x', 0, 0, 1, 0.005),
  num('ay', 'area y', 0, 0, 1, 0.005),
  num('aw', 'area width', 1, 0, 1, 0.005),
  num('ah', 'area height', 1, 0, 1, 0.005),
];

// A reader registers how it wants the screen sampled, and hands back a
// selection of whatever it produced. The renderer does the sampling; nothing
// here touches a pixel.
//
// The selection keys on what the units ARE, not on a path prefix: an element
// path is whatever the application happens to call its hierarchy, and
// `under: ''` would match every unit including the tiles. Tiles and regions
// declare their own kind, and an element is anything that is neither.
const TILE   = { t: 'kind', v: 'tile' };
const REGION = { t: 'kind', v: 'region' };
const ELEMENT = { t: 'not', a: { t: 'or', a: TILE, b: REGION } };

const register = (c, spec, match, label) => {
  if (c.out) (c.out.$read ??= []).push({ ...spec, _y: c.node ? c.node.y : 0 });
  return [sel(match, label)];
};

export const READ_OPS = {

// ---------------------------------------------------------------- elements
// What the applications declare: role, text, rectangle, and a path through
// the hierarchy. The only reader that knows a button is a button.
'read.elements': { cat:'read', title:'Read elements', color:C.read, w:214,
  ins:[], outs:[SEL_OUT],
  params:[ selp('scope', 'scope', 'focused window', ['focused window', 'all apps']),
           num('maxEl', 'max elements', 400, 20, 1200, 10),
           ...AREA ],
  init:()=>({}),
  eval:(p,i,s,c)=>register(c, { kind:'elements', scope:p.scope, maxEl:p.maxEl,
    ax:p.ax, ay:p.ay, aw:p.aw, ah:p.ah }, ELEMENT, 'every element') },

// ---------------------------------------------------------------- grid
// Fixed tiles. The only reader whose cost you know in advance: columns times
// rows, every frame, whatever is on screen.
//
// This is also the honest form of "pixel by pixel". A 2940x1838 screen is 5.4
// million pixels; as addressable things you could select and transform, that
// is not a resolution setting, it is a different program. A fine grid is
// per-pixel reading at a density you can work with, and the density is yours.
'read.grid': { cat:'read', title:'Read grid', color:C.read, w:214,
  ins:[{k:'cols',label:'columns'},{k:'rows',label:'rows'}],
  outs:[SEL_OUT],
  params:[ num('cols', 'columns', 16, 1, 160, 1),
           num('rows', 'rows', 10, 1, 160, 1),
           ...AREA ],
  init:()=>({}),
  eval:(p,i,s,c)=>register(c, { kind:'grid',
    cols: Math.round(pk(i,0,p,'cols')), rows: Math.round(pk(i,1,p,'rows')),
    ax:p.ax, ay:p.ay, aw:p.aw, ah:p.ah }, TILE, 'every tile') },

// ---------------------------------------------------------------- regions
// "Grids of pixels until something is recognised."
//
// Measure a fine grid, then merge neighbouring tiles that look alike.
// Nothing here knows what a button is — but the result follows the CONTENT:
// a photograph becomes one region, a toolbar a strip, a block of text a patch
// of high edge density. It sees what Accessibility cannot.
//
// Tolerance is the whole character of it. Loose keeps a gradient whole; tight
// shatters it into bands.
'read.regions': { cat:'read', title:'Read regions', color:C.read, w:226,
  ins:[{k:'tol',label:'tolerance'},{k:'min',label:'min size'}],
  outs:[SEL_OUT],
  params:[ num('tol', 'tolerance', 0.09, 0.005, 0.6, 0.005),
           num('min', 'min tiles', 3, 1, 200, 1),
           num('max', 'max regions', 60, 1, 400, 1),
           num('cols', 'detail columns', 40, 4, 120, 1),
           num('rows', 'detail rows', 25, 4, 120, 1),
           ...AREA ],
  init:()=>({}),
  eval:(p,i,s,c)=>register(c, { kind:'regions',
    tol: pk(i,0,p,'tol'), min: Math.round(pk(i,1,p,'min')), max: p.max,
    cols: p.cols, rows: p.rows,
    ax:p.ax, ay:p.ay, aw:p.aw, ah:p.ah }, REGION, 'every region') },

};

export const READ_CATS = [ ['read','Read — how to see the screen'] ];
