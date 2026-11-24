// shapeops.js — shapes, shape transformers, and the colourisers.
//
// This is the Scanimate half of the patcher. The 1969 machine worked like this:
// a high-contrast piece of artwork was shot by a camera, its video ran through
// an analogue computer that bent the display's DEFLECTION signals, and the
// monochrome result went into a COLOURISER that turned bands of grey into
// colour and transparency. Layers accumulated by re-recording pass over pass.
//
// The visualizer already has three of those four stages — source raster, scan
// processor, feedback loop. What it lacked was artwork to put in, and a real
// colouriser to put on the end. These operators are those two things.
//
// Everything here is a modulation target. A shape's radius, a boolean's blend
// radius, a colour band's edge: all of them are inputs, so a telemetry channel
// can drive any of them. That is the whole point of rebuilding Scanimate rather
// than drawing shapes in code.

import { num, sel, col, curve, fin, makeCurve, hexToRgb, TURN } from './opkit.js';
import { shape, NOTHING, isShape, depthOf, MAX_DEPTH } from './sdf.js';

// An input value if one is wired, else the node's own parameter. Same idea as
// the Mix operator's `t`: every knob is also a jack.
const pk = (i, idx, p, k) => (i[idx] == null ? p[k] : fin(i[idx]));
const sh = v => (isShape(v) ? v : null);

// Wrapping guards against graph cycles. A shape fed back into its own
// transformer would nest one level deeper every frame and grow without bound,
// so past MAX_DEPTH the wrapper becomes a pass-through instead.
function wrap1(child, build) {
  const c = sh(child);
  if (!c) return NOTHING;
  const n = depthOf(c) + 1;
  return n > MAX_DEPTH ? c : shape(build(c.d), n);          // hold, do not reset
}
function wrap2(a, b, build, bias) {
  const A = sh(a), B = sh(b);
  if (!A && !B) return NOTHING;
  if (!A) return bias === 'a' ? NOTHING : B;                // a missing input
  if (!B) return A;
  const n = Math.max(depthOf(A), depthOf(B)) + 1;
  // At the cap, pass through whichever side is DEEPER. Returning the shallower
  // side would discard everything a feedback loop had accumulated and the
  // shape would visibly snap back to one copy every few frames; passing the
  // deeper side through makes the nesting freeze instead, which is stable.
  if (n > MAX_DEPTH) return depthOf(A) >= depthOf(B) ? A : B;
  return shape(build(A.d, B.d), n);
}

const SHAPE_IN  = { k:'sh', label:'shape', shape:true };
const SHAPE_OUT = { k:'sh', label:'shape', shape:true };
const C = { src:'#5fb08a', xf:'#8f9f5a', op:'#b09a5a', ren:'#c7563f', col:'#a85fa8' };

const RES = ['low','med','high'];
const RENDER_PARAMS = [
  num('luma','brightness',0.8,0,1,0.01),
  num('warm','chroma (keys colour)',0.15,0,1,0.01),
  sel('route','route','scanned',['scanned','raw']),
  sel('blend','blend','add',['add','max']),
  sel('res','field res','med',RES),
];

export const SHAPE_OPS = {

// ================================================================ primitives
// Position is a parameter; motion belongs to the transformers, so a moving
// shape is a chain and not a special case. Size and form are jacks.

'sdf.circle': { cat:'shape', title:'Circle', color:C.src, w:176,
  ins:[{k:'r',label:'radius'}], outs:[SHAPE_OUT],
  params:[ num('x','centre x',0,-1.2,1.2,0.005), num('y','centre y',0,-0.8,0.8,0.005),
           num('r','radius',0.22,0.001,1.5,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ shape({ t:'circle', x:p.x, y:p.y, r:pk(i,0,p,'r') }) ] },

'sdf.box': { cat:'shape', title:'Box', color:C.src, w:186,
  ins:[{k:'w',label:'width'},{k:'h',label:'height'},{k:'r',label:'corner'}], outs:[SHAPE_OUT],
  params:[ num('x','centre x',0,-1.2,1.2,0.005), num('y','centre y',0,-0.8,0.8,0.005),
           num('w','half width',0.26,0.001,1.5,0.005), num('h','half height',0.16,0.001,1.5,0.005),
           num('r','corner',0.02,0,0.6,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ shape({ t:'box', x:p.x, y:p.y,
    w:pk(i,0,p,'w'), h:pk(i,1,p,'h'), r:Math.max(0,pk(i,2,p,'r')) }) ] },

// `radius` is the apothem: the distance to an edge midpoint, not to a vertex.
// Sides is continuous on the jack but rounds, so sweeping it steps 5 -> 6.
'sdf.ngon': { cat:'shape', title:'N-gon', color:C.src, w:186,
  ins:[{k:'r',label:'radius'},{k:'n',label:'sides'},{k:'a',label:'rot'}], outs:[SHAPE_OUT],
  params:[ num('x','centre x',0,-1.2,1.2,0.005), num('y','centre y',0,-0.8,0.8,0.005),
           num('r','apothem',0.2,0.001,1.5,0.005), num('n','sides',6,3,24,1),
           num('a','rot turns',0,-4,4,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ shape({ t:'ngon', x:p.x, y:p.y,
    r:pk(i,0,p,'r'), n:pk(i,1,p,'n'), a:pk(i,2,p,'a')*TURN }) ] },

// `sharp` 0 collapses the star to its n-gon, 1 is the spikiest it can be, and
// everything between is a real intermediate form — so it is worth modulating.
'sdf.star': { cat:'shape', title:'Star', color:C.src, w:196,
  ins:[{k:'r',label:'radius'},{k:'n',label:'points'},{k:'s',label:'sharp'},{k:'a',label:'rot'}],
  outs:[SHAPE_OUT],
  params:[ num('x','centre x',0,-1.2,1.2,0.005), num('y','centre y',0,-0.8,0.8,0.005),
           num('r','radius',0.28,0.001,1.5,0.005), num('n','points',5,3,24,1),
           num('s','sharp',0.7,0,1,0.01), num('a','rot turns',0,-4,4,0.005) ],
  init:()=>({}),
  eval:(p,i)=>{
    const n = pk(i,1,p,'n');
    const s = Math.min(1, Math.max(0, pk(i,2,p,'s')));
    return [ shape({ t:'star', x:p.x, y:p.y, r:pk(i,0,p,'r'), n,
      m: 2 + (1 - s) * (Math.max(3, Math.round(n)) - 2), a:pk(i,3,p,'a')*TURN }) ]; } },

'sdf.ring': { cat:'shape', title:'Ring', color:C.src, w:186,
  ins:[{k:'r',label:'radius'},{k:'t',label:'thick'}], outs:[SHAPE_OUT],
  params:[ num('x','centre x',0,-1.2,1.2,0.005), num('y','centre y',0,-0.8,0.8,0.005),
           num('r','radius',0.26,0.001,1.5,0.005), num('th','thickness',0.04,0.001,0.8,0.002) ],
  init:()=>({}),
  eval:(p,i)=>[ shape({ t:'ring', x:p.x, y:p.y, r:pk(i,0,p,'r'), th:pk(i,1,p,'th') }) ] },

'sdf.seg': { cat:'shape', title:'Segment', color:C.src, w:186,
  ins:[{k:'t',label:'thick'}], outs:[SHAPE_OUT],
  params:[ num('x1','x1',-0.3,-1.2,1.2,0.005), num('y1','y1',0,-0.8,0.8,0.005),
           num('x2','x2',0.3,-1.2,1.2,0.005), num('y2','y2',0,-0.8,0.8,0.005),
           num('th','thickness',0.03,0.001,0.6,0.002) ],
  init:()=>({}),
  eval:(p,i)=>[ shape({ t:'seg', x1:p.x1, y1:p.y1, x2:p.x2, y2:p.y2, th:pk(i,0,p,'th') }) ] },

'sdf.arc': { cat:'shape', title:'Arc', color:C.src, w:196,
  ins:[{k:'r',label:'radius'},{k:'ap',label:'aperture'},{k:'a',label:'rot'}], outs:[SHAPE_OUT],
  params:[ num('x','centre x',0,-1.2,1.2,0.005), num('y','centre y',0,-0.8,0.8,0.005),
           num('r','radius',0.26,0.001,1.5,0.005), num('th','thickness',0.03,0.001,0.6,0.002),
           num('ap','aperture turns',0.25,0.001,0.5,0.005), num('a','rot turns',0,-4,4,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ shape({ t:'arc', x:p.x, y:p.y, r:pk(i,0,p,'r'), th:p.th,
    ap:Math.min(0.4999,Math.max(0.001,pk(i,1,p,'ap')))*TURN, a:pk(i,2,p,'a')*TURN }) ] },

// A DRAWN SHAPE. The curve is a radial profile: angle around the shape reads
// left-to-right along the drawing, and height becomes radius. Draw a profile,
// get geometry. This is the shortest path from a sketch to something the whole
// signal chain then processes.
'sdf.curve': { cat:'shape', title:'Drawn profile', color:C.src, w:214,
  ins:[{k:'r0',label:'inner'},{k:'r1',label:'outer'},{k:'a',label:'rot'}], outs:[SHAPE_OUT],
  params:[ curve('cv','radius by angle', makeCurve('hump')),
           num('x','centre x',0,-1.2,1.2,0.005), num('y','centre y',0,-0.8,0.8,0.005),
           num('r0','inner r',0.08,0,1.5,0.005), num('r1','outer r',0.34,0,1.5,0.005),
           num('a','rot turns',0,-4,4,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ shape({ t:'pcurve', x:p.x, y:p.y, cv:p.cv,
    r0:pk(i,0,p,'r0'), r1:pk(i,1,p,'r1'), a:pk(i,2,p,'a')*TURN }) ] },

// ================================================================ transformers

'sh.move': { cat:'xform', title:'Move', color:C.xf, w:176,
  ins:[SHAPE_IN,{k:'dx',label:'dx'},{k:'dy',label:'dy'}], outs:[SHAPE_OUT],
  params:[ num('dx','dx',0,-2,2,0.005), num('dy','dy',0,-2,2,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'xform', c:d, tx:pk(i,1,p,'dx'), ty:pk(i,2,p,'dy'),
    rot:0, sx:1, sy:1, kx:0, ky:0 })) ] },

'sh.rotate': { cat:'xform', title:'Rotate', color:C.xf, w:176,
  ins:[SHAPE_IN,{k:'a',label:'turns'}], outs:[SHAPE_OUT],
  params:[ num('a','turns',0,-8,8,0.002) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'xform', c:d, tx:0, ty:0,
    rot:pk(i,1,p,'a')*TURN, sx:1, sy:1, kx:0, ky:0 })) ] },

// `uniform` multiplies both axes, so one jack can pulse a shape's whole size.
'sh.scale': { cat:'xform', title:'Scale', color:C.xf, w:186,
  ins:[SHAPE_IN,{k:'s',label:'uniform'},{k:'sx',label:'x'},{k:'sy',label:'y'}], outs:[SHAPE_OUT],
  params:[ num('s','uniform',1,0.01,8,0.005), num('sx','x',1,0.01,8,0.005), num('sy','y',1,0.01,8,0.005) ],
  init:()=>({}),
  eval:(p,i)=>{ const u = pk(i,1,p,'s');
    return [ wrap1(i[0], d=>({ t:'xform', c:d, tx:0, ty:0, rot:0,
      sx:pk(i,2,p,'sx')*u, sy:pk(i,3,p,'sy')*u, kx:0, ky:0 })) ]; } },

'sh.skew': { cat:'xform', title:'Skew', color:C.xf, w:176,
  ins:[SHAPE_IN,{k:'kx',label:'kx'},{k:'ky',label:'ky'}], outs:[SHAPE_OUT],
  params:[ num('kx','x by y',0,-2,2,0.005), num('ky','y by x',0,-2,2,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'xform', c:d, tx:0, ty:0, rot:0, sx:1, sy:1,
    kx:pk(i,1,p,'kx'), ky:pk(i,2,p,'ky') })) ] },

// Scanimate's signature gesture: a scale that varies along the opposite axis,
// so a shape tapers instead of merely shearing.
'sh.squeeze': { cat:'xform', title:'Squeeze', color:C.xf, w:186,
  ins:[SHAPE_IN,{k:'q',label:'amount'}], outs:[SHAPE_OUT],
  params:[ num('q','amount',0.8,-4,4,0.01), sel('ax','varies along','y',['y','x']),
           num('x','pivot x',0,-1.2,1.2,0.005), num('y','pivot y',0,-0.8,0.8,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'squeeze', c:d, q:pk(i,1,p,'q'), ax:p.ax, x:p.x, y:p.y })) ] },

'sh.repeat': { cat:'xform', title:'Repeat', color:C.xf, w:186,
  ins:[SHAPE_IN,{k:'px',label:'pitch x'},{k:'py',label:'pitch y'}], outs:[SHAPE_OUT],
  params:[ num('px','pitch x',0.4,0,2,0.005), num('nx','count x',2,0,12,1),
           num('py','pitch y',0,0,2,0.005), num('ny','count y',0,0,12,1) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'repeat', c:d,
    px:pk(i,1,p,'px'), nx:p.nx, py:pk(i,2,p,'py'), ny:p.ny })) ] },

'sh.mirror': { cat:'xform', title:'Mirror', color:C.xf, w:166,
  ins:[SHAPE_IN], outs:[SHAPE_OUT],
  params:[ sel('mx','mirror x','on',['on','off']), sel('my','mirror y','off',['on','off']) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'mirror', c:d, mx:p.mx==='on'?1:0, my:p.my==='on'?1:0 })) ] },

'sh.polar': { cat:'xform', title:'Polar array', color:C.xf, w:196,
  ins:[SHAPE_IN,{k:'n',label:'count'},{k:'a',label:'rot'}], outs:[SHAPE_OUT],
  params:[ num('n','count',6,1,36,1), num('a','rot turns',0,-4,4,0.002) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'polar', c:d, n:pk(i,1,p,'n'), a:pk(i,2,p,'a')*TURN })) ] },

'sh.twist': { cat:'xform', title:'Twist', color:C.xf, w:176,
  ins:[SHAPE_IN,{k:'k',label:'amount'}], outs:[SHAPE_OUT],
  params:[ num('k','turns per unit',1,-12,12,0.01) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'twist', c:d, k:pk(i,1,p,'k')*TURN })) ] },

// Inflating the field rounds every corner at once, which is a thing only a
// distance field can do: there is no path to edit.
'sh.round': { cat:'xform', title:'Inflate', color:C.xf, w:176,
  ins:[SHAPE_IN,{k:'r',label:'amount'}], outs:[SHAPE_OUT],
  params:[ num('r','amount',0.03,-0.5,0.5,0.002) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'round', c:d, r:pk(i,1,p,'r') })) ] },

// Hollow out any solid into a shell of the given thickness.
'sh.onion': { cat:'xform', title:'Hollow', color:C.xf, w:176,
  ins:[SHAPE_IN,{k:'t',label:'thick'}], outs:[SHAPE_OUT],
  params:[ num('th','thickness',0.03,0.001,0.5,0.002) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap1(i[0], d=>({ t:'onion', c:d, th:pk(i,1,p,'th') })) ] },

// ================================================================ combine

'sh.union': { cat:'shapeop', title:'Union', color:C.op, w:166,
  ins:[{k:'a',label:'a',shape:true},{k:'b',label:'b',shape:true}], outs:[SHAPE_OUT],
  params:[], init:()=>({}),
  eval:(p,i)=>[ wrap2(i[0], i[1], (a,b)=>({ t:'union', a, b })) ] },

'sh.sub': { cat:'shapeop', title:'Subtract', color:C.op, w:176,
  ins:[{k:'a',label:'from',shape:true},{k:'b',label:'cut',shape:true}], outs:[SHAPE_OUT],
  params:[], init:()=>({}),
  eval:(p,i)=>[ wrap2(i[0], i[1], (a,b)=>({ t:'sub', a, b }), 'a') ] },

'sh.inter': { cat:'shapeop', title:'Intersect', color:C.op, w:176,
  ins:[{k:'a',label:'a',shape:true},{k:'b',label:'b',shape:true}], outs:[SHAPE_OUT],
  params:[], init:()=>({}),
  eval:(p,i)=>[ wrap2(i[0], i[1], (a,b)=>({ t:'inter', a, b }), 'a') ] },

// Smooth minimum. At k = 0 this is a hard union; raise k and the two shapes
// grow a fillet into each other. Driving k from telemetry makes two separate
// objects become one and separate again.
'sh.blend': { cat:'shapeop', title:'Blend', color:C.op, w:196,
  ins:[{k:'a',label:'a',shape:true},{k:'b',label:'b',shape:true},{k:'k',label:'radius'}],
  outs:[SHAPE_OUT],
  params:[ num('k','radius',0.1,0,0.8,0.005), sel('mode','mode','union',['union','subtract']) ],
  init:()=>({}),
  eval:(p,i)=>{ const k = Math.max(0, pk(i,2,p,'k'));
    return [ wrap2(i[0], i[1], (a,b)=>({ t: p.mode==='subtract'?'sblend':'blend', a, b, k }),
                   p.mode==='subtract' ? 'a' : undefined) ]; } },

// Lerping two distance fields tweens the SHAPES. A circle becomes a star
// through forms that are neither — the thing keyframe animation cannot do and
// the thing the analogue machines were best at.
'sh.morph': { cat:'shapeop', title:'Morph', color:C.op, w:196,
  ins:[{k:'a',label:'a',shape:true},{k:'b',label:'b',shape:true},{k:'t',label:'t'}],
  outs:[SHAPE_OUT],
  params:[ num('t','t',0.5,0,1,0.005) ],
  init:()=>({}),
  eval:(p,i)=>[ wrap2(i[0], i[1], (a,b)=>({ t:'morph', a, b, t2:pk(i,2,p,'t') })) ] },

// ================================================================ render
//
// These are the SINKS for shapes. A fill or contour does not draw: it hands
// the renderer a field plus instructions, and viz/shapes.js rasterizes it into
// the same luminance raster the machine map is drawn into. So a shape is
// deflected by the scan processor and smeared by the feedback loop for free —
// unless `route` is set to raw, which composites it crisp above the field.

'sh.fill': { cat:'render', title:'Fill', color:C.ren, w:214,
  ins:[SHAPE_IN,{k:'luma',label:'brightness'},{k:'lvl',label:'level'}], outs:[],
  params:[ num('lvl','level',0,-0.5,0.5,0.002), num('soft','edge softness',0.012,0,0.3,0.001),
           ...RENDER_PARAMS ],
  init:()=>({}),
  eval:(p,i,s,c)=>{
    const S = sh(i[0]);
    if (S && c.shapes) c.shapes.push({ kind:'fill', spec:S.d,
      lvl:pk(i,2,p,'lvl'), soft:Math.max(0.0005,p.soft),
      luma:Math.min(1,Math.max(0,pk(i,1,p,'luma'))), warm:p.warm,
      route:p.route, blend:p.blend, res:p.res });
    return []; } },

// Concentric contours out of ONE field, at d = lvl, lvl+spacing, lvl+2*spacing.
// There is no way to do this with paths; it falls out of the distance field,
// and it is the most video-synthesiser-looking thing in the set.
'sh.contour': { cat:'render', title:'Contour', color:C.ren, w:214,
  ins:[SHAPE_IN,{k:'luma',label:'brightness'},{k:'sp',label:'spacing'}], outs:[],
  params:[ num('lvl','first at',0,-0.5,0.5,0.002), num('wid','line width',0.006,0.0005,0.1,0.0005),
           num('rings','rings',3,1,24,1), num('sp','spacing',0.045,0.002,0.5,0.001),
           num('fall','outer fade',0.45,0,1,0.01),
           ...RENDER_PARAMS ],
  init:()=>({}),
  eval:(p,i,s,c)=>{
    const S = sh(i[0]);
    if (S && c.shapes) c.shapes.push({ kind:'contour', spec:S.d,
      lvl:p.lvl, wid:Math.max(0.0005,p.wid), rings:Math.max(1,Math.round(p.rings)),
      sp:Math.max(0.002,pk(i,2,p,'sp')), fall:p.fall,
      luma:Math.min(1,Math.max(0,pk(i,1,p,'luma'))), warm:p.warm,
      route:p.route, blend:p.blend, res:p.res });
    return []; } },

// ================================================================ colourisers
//
// Scanimate's output was always monochrome; all of its colour came from a
// colouriser downstream that "takes certain shades of grey and turns it into
// colour as well as transparency". Both of these replace the visualizer's
// two-colour warm/cool key. Whichever one evaluates last wins.

// The authentic one: hard luminance bands. Because the band edges are jacks,
// a telemetry channel can slide a colour boundary across the whole image, and
// the edge stays hard the way an analogue keyer's did.
'col.keyer': { cat:'color', title:'Luma keyer', color:C.col, w:226,
  ins:[{k:'e1',label:'edge 1'},{k:'e2',label:'edge 2'},{k:'e3',label:'edge 3'}], outs:[],
  params:[
    col('c0','band 0 colour','#0a1c26'), num('a0','band 0 alpha',0.25,0,1,0.01),
    num('e1','edge 1',0.30,0,1,0.005),
    col('c1','band 1 colour','#35e0ff'), num('a1','band 1 alpha',0.70,0,1,0.01),
    num('e2','edge 2',0.62,0,1,0.005),
    col('c2','band 2 colour','#ffa02a'), num('a2','band 2 alpha',0.90,0,1,0.01),
    num('e3','edge 3',0.86,0,1,0.005),
    col('c3','band 3 colour','#ffffff'), num('a3','band 3 alpha',1,0,1,0.01),
    num('soft','edge softness',0,0,0.3,0.002),
  ],
  init:()=>({}),
  eval:(p,i,s,c)=>{
    if (c.out) c.out.$color = { mode:'keyer',
      stops:[ { c:hexToRgb(p.c0), a:p.a0 }, { c:hexToRgb(p.c1), a:p.a1 },
              { c:hexToRgb(p.c2), a:p.a2 }, { c:hexToRgb(p.c3), a:p.a3 } ],
      edges:[ pk(i,0,p,'e1'), pk(i,1,p,'e2'), pk(i,2,p,'e3') ],
      soft:p.soft };
    return []; } },

// The smooth one: luminance drives a four-stop gradient. `hue` rotates every
// stop at once, so a single channel can sweep the entire palette.
'col.ramp': { cat:'color', title:'Gradient ramp', color:C.col, w:226,
  ins:[{k:'off',label:'offset'},{k:'g',label:'gamma'},{k:'hue',label:'hue turns'}], outs:[],
  params:[
    col('c0','stop 0','#04070d'), num('p0','at',0,0,1,0.005),
    col('c1','stop 1','#0d5f7a'), num('p1','at',0.35,0,1,0.005),
    col('c2','stop 2','#35e0ff'), num('p2','at',0.72,0,1,0.005),
    col('c3','stop 3','#ffffff'), num('p3','at',1,0,1,0.005),
    num('off','offset',0,-1,1,0.005), num('g','gamma',1,0.1,6,0.01),
    num('hue','hue turns',0,-1,1,0.005), num('alpha','alpha scale',1,0,1,0.01),
  ],
  init:()=>({}),
  eval:(p,i,s,c)=>{
    if (c.out) c.out.$color = { mode:'ramp',
      stops:[ { c:hexToRgb(p.c0), p:p.p0 }, { c:hexToRgb(p.c1), p:p.p1 },
              { c:hexToRgb(p.c2), p:p.p2 }, { c:hexToRgb(p.c3), p:p.p3 } ],
      off:pk(i,0,p,'off'), gamma:Math.max(0.05,pk(i,1,p,'g')),
      hue:pk(i,2,p,'hue'), alpha:p.alpha };
    return []; } },

};

export const SHAPE_CATS = [
  ['shape',   'Shapes (SDF)'],
  ['xform',   'Shape transformers'],
  ['shapeop', 'Shape combine'],
  ['render',  'Shape render'],
  ['color',   'Colourisers'],
];
