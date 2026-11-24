// selectops.js — the WHICH half of an effect.
//
// Every block here answers "which elements", and nothing else. They produce a
// selection, which travels on a wire to one or more effects. That split is
// what makes effects combinable: one selection can feed three effects, and
// two selections can be merged before they reach any.
//
//   Pick by role ---+
//                   +--> Combine (and) --> [selection] --> Wave
//   Pick by app ----+                                  \
//                                                       -> Scale glyphs
//
// An effect with nothing wired to its selection input falls back to its own
// `applies to` dropdown, so simple patches stay simple and nothing that
// already worked stops working.
//
// `Pick element` is the one filled in by clicking: choose something in the
// inspector on the right and it writes that element's path and text in here.

import { num, sel as selp, txt, fin } from './opkit.js';
const sel_ = selp;
import { sel, ALL, describe } from './selection.js';

const C = { pick: '#d09a4a' };
const SEL_OUT = { k: 'sel', label: 'selection', seltype: true };
const SEL_IN  = { k: 'sel', label: 'selection', seltype: true };
export { SEL_IN, SEL_OUT };

const asSel = v => (v && v.$ === 'sel' ? v : null);

export const SELECT_OPS = {

// ---------------------------------------------------------------- everything
'pick.all': { cat:'pick', title:'Everything', color:C.pick, w:166,
  ins:[], outs:[SEL_OUT], params:[], init:()=>({}),
  eval:()=>[ALL] },

// ------------------------------------------------------------- one element
// Filled in by clicking an element in the inspector. Matched on its path
// through the hierarchy plus its text, because an element has no stable id
// across snapshots: the same button is a new reference every time the tree
// is walked.
'pick.element': { cat:'pick', title:'This element', color:C.pick, w:240,
  ins:[], outs:[SEL_OUT],
  params:[ txt('path','hierarchy path',''), txt('text','text','') ],
  init:()=>({}),
  eval:(p)=>[ p.path || p.text
    ? sel({ t:'elem', path:p.path, text:p.text || undefined }, p.text || p.path)
    : sel({ t:'none' }, 'nothing picked') ] },

// ------------------------------------------------------- everything under
// A whole window, a whole toolbar, a whole group. Click a container in the
// inspector to fill this in.
'pick.under': { cat:'pick', title:'Everything under', color:C.pick, w:240,
  ins:[], outs:[SEL_OUT],
  params:[ txt('path','hierarchy path','') ],
  init:()=>({}),
  eval:(p)=>[ p.path ? sel({ t:'under', path:p.path }, 'under ' + p.path.split('>').pop())
                     : sel({ t:'none' }, 'nothing picked') ] },

// ---------------------------------------------------------------- by role
'pick.role': { cat:'pick', title:'By role', color:C.pick, w:214,
  ins:[], outs:[SEL_OUT],
  params:[ selp('v','role','AXStaticText',
    ['AXStaticText','AXButton','AXTextField','AXTextArea','AXMenuBarItem','AXMenuItem',
     'AXCell','AXRow','AXImage','AXGroup','AXCheckBox','AXPopUpButton','AXTab','AXLink',
     'AXToolbar','AXWindow','AXOutline','AXList','AXScrollArea']) ],
  init:()=>({}),
  eval:(p)=>[ sel({ t:'role', v:p.v }, p.v.replace(/^AX/,'')) ] },

// ----------------------------------------------------------------- by app
'pick.app': { cat:'pick', title:'By application', color:C.pick, w:240,
  ins:[], outs:[SEL_OUT],
  params:[ txt('v','application name','') ],
  init:()=>({}),
  eval:(p)=>[ p.v ? sel({ t:'app', v:p.v }, 'in ' + p.v) : ALL ] },

// --------------------------------------------------------- by what it IS
// Semantic class, from the text itself: a path, a number, a URL, a sentence.
// "Every number on screen, wherever it is" is one block.
'pick.class': { cat:'pick', title:'By what it is', color:C.pick, w:214,
  ins:[], outs:[SEL_OUT],
  params:[ selp('v','class','sentence',
    ['sentence','word','identifier','number','path','url','date','time','size','symbol']) ],
  init:()=>({}),
  eval:(p)=>[ sel({ t:'class', v:p.v }, 'any ' + p.v) ] },

// ------------------------------------------------------- by what part it is
'pick.kind': { cat:'pick', title:'By part of the UI', color:C.pick, w:214,
  ins:[], outs:[SEL_OUT],
  params:[ selp('v','part','body',['menu','title','body','name','label']) ],
  init:()=>({}),
  eval:(p)=>[ sel({ t:'kind', v:p.v }, p.v) ] },

// --------------------------------------------------------- by a measurement
// "Every long sentence", "everything buried deep in the hierarchy".
'pick.range': { cat:'pick', title:'By measurement', color:C.pick, w:226,
  ins:[{k:'lo',label:'from'},{k:'hi',label:'to'}], outs:[SEL_OUT],
  // Text measures first, then the ones the screen readers produce. A grid
  // tile has no entropy and a sentence has no edge density; asking for the
  // wrong one simply matches nothing, which is the safe direction.
  params:[ selp('k','measure','entropy',
             ['entropy','depth','len','words','digits','caps','ttr',
              'bright','hue','sat','edge','busy','fill','area','tiles']),
           num('lo','from',0,-1e6,1e6,0.01), num('hi','to',99,-1e6,1e6,0.01) ],
  init:()=>({}),
  eval:(p,i)=>[ sel({ t:'range', k:p.k,
    lo: i[0] == null ? p.lo : fin(i[0]),
    hi: i[1] == null ? p.hi : fin(i[1]) }, p.k) ] },

// ---------------------------------------------------------------- combine
// Two selections into one. This is what lets you say "the filenames in
// Finder but not the sidebar" without a special case anywhere.
'pick.combine': { cat:'pick', title:'Combine', color:C.pick, w:214,
  ins:[{ ...SEL_IN, k:'a', label:'a' }, { ...SEL_IN, k:'b', label:'b' }],
  outs:[SEL_OUT],
  params:[ selp('mode','mode','and',['and','or','a not b']) ],
  init:()=>({}),
  eval:(p,i)=>{
    const a = asSel(i[0]), b = asSel(i[1]);
    if (!a && !b) return [sel({ t:'none' }, 'nothing')];
    if (!a) return [b];
    if (!b) return [a];
    const m = p.mode === 'or'      ? { t:'or',  a:a.m, b:b.m }
            : p.mode === 'a not b' ? { t:'and', a:a.m, b:{ t:'not', a:b.m } }
            :                        { t:'and', a:a.m, b:b.m };
    return [sel(m, describe(m))];
  } },

// -------------------------------------------------------- inside a shape
// The custom region. Wire any shape block in -- a circle, a star, a ring, or
// a whole boolean assembly run through the shape transformers -- and this
// selects whatever falls inside it. "A custom group of pixels" is a shape,
// so everything already built for drawing shapes becomes a way of choosing
// them.
'pick.shape': { cat:'pick', title:'Inside a shape', color:C.pick, w:226,
  ins:[{ k:'shape', label:'shape', shape:true }], outs:[SEL_OUT],
  params:[ sel_('side','side','inside',['inside','outside']),
           // Distance in field units: positive grows the region past the
           // outline, negative eats into it. Lets one shape be a soft core
           // and a hard rim without drawing it twice.
           num('edge','grow edge',0,-0.5,0.5,0.005) ],
  init:()=>({}),
  eval:(p,i)=>{ const sh = i[0];
    if (!sh || sh.$ !== 'shape') return [sel({ t:'none' }, 'no shape wired')];
    return [sel({ t:'inside', d: sh.d, out: p.side === 'outside', edge: p.edge },
                p.side === 'outside' ? 'outside the shape' : 'inside the shape')]; } },

'pick.invert': { cat:'pick', title:'Everything except', color:C.pick, w:214,
  ins:[SEL_IN], outs:[SEL_OUT], params:[], init:()=>({}),
  eval:(p,i)=>{ const a = asSel(i[0]);
    return [a ? sel({ t:'not', a:a.m }, 'not ' + (a.label || '')) : ALL]; } },

};

export const SELECT_CATS = [ ['pick','Pick — which elements'] ];
