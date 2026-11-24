// textops.js — typography as a signal destination.
//
// The Psychedelic OS treats every letter on screen as an object with its own
// position, rotation, size and weight. These operators do not transform glyphs
// themselves: each one pushes a MODULATOR onto a stack, and the renderer walks
// every glyph through the stack once per frame. Same arrangement as the shape
// operators — the patch describes what should happen, the renderer does it —
// and it is what keeps 2,000 glyphs affordable.
//
// ORDER. Modulators apply TOP TO BOTTOM by where their nodes sit on the
// canvas, like a layer stack. This matters: a Cascade delay only affects the
// modulators below it, and two waves stack differently from one wave and a
// scatter. Drag a node up or down to change when it runs.
//
// THE ONE IDEA WORTH UNDERSTANDING: `phase from`.
//
// Every modulator reads one coordinate off each glyph and uses it as the phase
// of its effect. That single control is what turns one operator into a dozen:
//
//   index   position within the word   -> a wave travels along each word
//   char    position in the whole run  -> one wave crosses all the text
//   word    which word it belongs to   -> words bounce as units, in sequence
//   line    which line it sits on      -> the effect ripples down the page
//   x / y   where it is on screen      -> a wave sweeps across the display
//   rand    a stable per-glyph hash    -> every letter does its own thing
//
// `rand` is hashed from the glyph's identity, not drawn fresh each frame, so
// scattered text stays scattered instead of boiling.
//
// Kinetic typography has a research lineage worth citing: Lee and Forlizzi's
// Kinetic Typography Engine (CMU, UIST 2002) is the standard reference, and
// variable fonts (OpenType 1.8) are what made continuous weight and width
// axes a supported idea rather than a hack.

import { num, sel, col, curve, fin, makeCurve } from './opkit.js';

const C = { txt:'#c77fa8' };

// Where a modulator reads its phase from. Kept here so every operator offers
// exactly the same list and the renderer has one place to implement it.
// The last six are SEMANTIC: they come from what the text is, not where it
// sits. Available on any source that carries analysis — the live screen via
// the Accessibility API, and anything else that chooses to supply it.
export const PHASE_FROM = ['index', 'char', 'word', 'line', 'x', 'y', 'rand',
                           'entropy', 'depth', 'digits', 'caps', 'ttr', 'words', 'none'];

// Which text a modulator applies to. The mock desktop tags every glyph with
// the kind of thing it belongs to, so an effect can hit filenames and leave
// body text alone.
// Role kinds first, then semantic classes. A target matches either, so
// "every number on screen" and "every filename" are the same kind of control.
export const TARGETS = ['all', 'title', 'body', 'name', 'menu', 'label',
                        'sentence', 'word', 'identifier', 'number', 'path',
                        'url', 'date', 'time', 'size', 'symbol'];

const pk = (i, idx, p, k) => (i[idx] == null ? p[k] : fin(i[idx]));

// Shared tail of parameters. Every modulator has the same three, which makes
// the family learnable: pick an effect, pick what it rides on, pick what it
// hits.
const COMMON = (fromDef = 'index') => ([
  sel('from', 'phase from', fromDef, PHASE_FROM),
  num('scale', 'phase scale', 1, -20, 20, 0.01),
  sel('target', 'applies to', 'all', TARGETS),
]);

export const TEXT_OPS = {

// ---------------------------------------------------------------- wave
// The bouncy one. A sinusoid displacing each glyph, with its phase taken from
// whichever coordinate you choose. `from: index` with a small scale is a wave
// running along every word; `from: word` makes whole words bob in sequence.
'txt.wave': { cat:'text', title:'Wave', color:C.txt, w:214,
  ins:[{k:'amp',label:'amplitude'},{k:'f',label:'rate'}],
  outs:[],
  params:[ num('amp','amplitude px',7,-200,200,0.1),
           num('f','rate Hz',0.5,0,12,0.01),
           sel('axis','axis','y',['y','x','both']),
           sel('shape','shape','sine',['sine','tri','square','bounce']),
           ...COMMON('index') ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'wave', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    amp:pk(i,0,p,'amp'), f:pk(i,1,p,'f'), axis:p.axis, shape:p.shape,
    from:p.from, scale:p.scale, target:p.target }); return []; } },

// ---------------------------------------------------------------- jitter
// Per-glyph noise. Seeded from the glyph's identity so the displacement is
// stable frame to frame — text that is scattered stays scattered rather than
// vibrating, which is the difference between "disturbed" and "broken".
'txt.jitter': { cat:'text', title:'Jitter', color:C.txt, w:214,
  ins:[{k:'amt',label:'amount'}], outs:[],
  params:[ num('amt','amount px',3,0,200,0.1),
           num('rot','rotation deg',0,0,180,0.1),
           num('rate','reseed Hz',0,0,30,0.1),
           num('seed','seed',1,0,999,1),
           sel('target','applies to','all',TARGETS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'jitter', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    amt:pk(i,0,p,'amt'), rot:p.rot, rate:p.rate, seed:p.seed, target:p.target }); return []; } },

// ---------------------------------------------------------------- rotate
'txt.rotate': { cat:'text', title:'Rotate glyphs', color:C.txt, w:214,
  ins:[{k:'a',label:'degrees'}], outs:[],
  params:[ num('a','degrees',12,-360,360,0.1),
           num('f','spin Hz',0,-8,8,0.01),
           sel('mode','mode','alternate',['alternate','uniform','ramp','phase']),
           ...COMMON('index') ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'rotate', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    a:pk(i,0,p,'a'), f:p.f, mode:p.mode,
    from:p.from, scale:p.scale, target:p.target }); return []; } },

// ---------------------------------------------------------------- scale
'txt.scale': { cat:'text', title:'Scale glyphs', color:C.txt, w:214,
  ins:[{k:'s',label:'amount'}], outs:[],
  params:[ num('s','amount',0.35,-3,8,0.01),
           num('f','pulse Hz',0,0,12,0.01),
           num('base','base',1,0.05,6,0.01),
           sel('axis','axis','both',['both','x','y']),
           // A floor in PIXELS, not a scale factor, because legibility is
           // about the size a letter ends up at: 0.3x on an 11pt label and
           // on a 28pt heading are not the same problem. 0 disables it.
           num('minpx','stay legible above px',0,0,40,0.5),
           ...COMMON('index') ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'scale', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    s:pk(i,0,p,'s'), f:p.f, base:p.base, axis:p.axis, minpx:p.minpx,
    from:p.from, scale:p.scale, target:p.target }); return []; } },

// ---------------------------------------------------------------- axes
// Weight, width and slant. Canvas2D cannot set OpenType variation axes, so
// these are synthesised: weight by stroking the glyph outline on top of the
// fill, width by scaling the advance and the glyph together, slant by a shear.
// Continuous and cheap, and it looks right — but it is NOT real variable-font
// interpolation, and a serious version would render text through the DOM or a
// signed-distance-field atlas to get the true axes.
'txt.axes': { cat:'text', title:'Weight / width / slant', color:C.txt, w:226,
  ins:[{k:'w',label:'weight'},{k:'d',label:'width'},{k:'s',label:'slant'}],
  outs:[],
  params:[ num('w','weight',0.6,-1,4,0.01),
           num('d','width',0,-0.6,2,0.01),
           num('s','slant deg',0,-45,45,0.1),
           num('f','modulate Hz',0,0,12,0.01),
           ...COMMON('word') ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'axes', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    w:pk(i,0,p,'w'), d:pk(i,1,p,'d'), sl:pk(i,2,p,'s'), f:p.f,
    from:p.from, scale:p.scale, target:p.target }); return []; } },

// ---------------------------------------------------------------- spacing
// Tracking and leading. Because the renderer lays out every glyph itself,
// these are just added advance and added line height — no font support needed,
// and both are continuous.
'txt.spacing': { cat:'text', title:'Tracking / leading', color:C.txt, w:214,
  ins:[{k:'t',label:'tracking'},{k:'l',label:'leading'}], outs:[],
  params:[ num('t','tracking px',0,-20,80,0.1),
           num('l','leading x',1,0.2,6,0.01),
           sel('grow','grows along','none',['none','index','word','line']),
           sel('target','applies to','all',TARGETS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'spacing', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    t:pk(i,0,p,'t'), l:pk(i,1,p,'l'), grow:p.grow, target:p.target }); return []; } },

// ---------------------------------------------------------------- baseline
// A drawn curve becomes the baseline. The horizontal position of a glyph
// reads across the drawing and the drawing's height becomes vertical offset,
// so a line of text follows a shape you sketched. Same drawn-coefficient idea
// as the kernel and mask operators: the drawing IS the function.
'txt.baseline': { cat:'text', title:'Drawn baseline', color:C.txt, w:226,
  ins:[{k:'amt',label:'amount'},{k:'sh',label:'shift'}], outs:[],
  params:[ curve('cv','baseline shape', makeCurve('hump')),
           num('amt','amount px',24,-400,400,0.5),
           num('sh','shift',0,-2,2,0.005),
           sel('span','spans','line',['line','screen','word']),
           sel('target','applies to','all',TARGETS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'baseline', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    cv:p.cv, amt:pk(i,0,p,'amt'), sh:pk(i,1,p,'sh'),
    span:p.span, target:p.target }); return []; } },

// ---------------------------------------------------------------- scatter
// Push glyphs away from where they belong. At 0 the text is exactly where it
// was laid out; raise it and the letters leave. The origin choice decides
// whether a word explodes, a line disperses, or the whole screen flies apart.
'txt.scatter': { cat:'text', title:'Scatter', color:C.txt, w:214,
  ins:[{k:'amt',label:'amount'}], outs:[],
  params:[ num('amt','amount',0,0,4,0.005),
           sel('origin','away from','word',['word','line','screen','point']),
           num('px','point x',0.5,0,1,0.005), num('py','point y',0.5,0,1,0.005),
           num('swirl','swirl deg',0,-360,360,1),
           sel('target','applies to','all',TARGETS) ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'scatter', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    amt:pk(i,0,p,'amt'), origin:p.origin, px:p.px, py:p.py,
    swirl:p.swirl, target:p.target }); return []; } },

// ---------------------------------------------------------------- colour
'txt.colour': { cat:'text', title:'Glyph colour', color:C.txt, w:214,
  ins:[{k:'h',label:'hue turns'},{k:'a',label:'alpha'}], outs:[],
  params:[ col('c','base colour','#d7e6f0'),
           num('h','hue turns',0,-2,2,0.005),
           num('a','alpha',1,0,1,0.01),
           num('f','cycle Hz',0,0,12,0.01),
           ...COMMON('char') ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'colour', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    base:p.c, h:pk(i,0,p,'h'), a:pk(i,1,p,'a'), f:p.f,
    from:p.from, scale:p.scale, target:p.target }); return []; } },

// ---------------------------------------------------------------- cascade
// Delay. Every modulator after this one is evaluated at a time offset that
// depends on the glyph's coordinate, so an effect ARRIVES rather than happens
// everywhere at once. This is what makes kinetic type read as motion with a
// direction instead of a uniform wobble.
'txt.cascade': { cat:'text', title:'Cascade delay', color:C.txt, w:214,
  ins:[{k:'d',label:'seconds'}], outs:[],
  params:[ num('d','delay s',0.04,-2,2,0.001),
           ...COMMON('char') ],
  init:()=>({}),
  eval:(p,i,s,c)=>{ if (c.text) c.text.push({ op:'cascade', _y:c.node?c.node.y:0, _x:c.node?c.node.x:0,
    d:pk(i,0,p,'d'), from:p.from, scale:p.scale, target:p.target }); return []; } },
};

export const TEXT_CATS = [ ['text','Typography'] ];
