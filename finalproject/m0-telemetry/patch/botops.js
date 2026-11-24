// botops.js — the filesystem as a growing tree.
//
// Kleiberg, van de Wetering & van Wijk, "Botanical Visualization of Huge
// Hierarchies" (IEEE InfoVis 2001): directories are stems, subdirectories are
// branches, sets of files are fruit.
//
// Unlike the typography and layout families these are not per-object
// modulators — they are GEOMETRY parameters, read once per frame before the
// tree is built, in the same way Tracking/leading has to be read before text
// is laid out. They merge into one `$bot` configuration, so several nodes can
// each own a few knobs without fighting.
//
// The point of putting every one of them here rather than in the layout code
// is that the shape of the tree is then a thing you tune, not a thing you
// inherit.

import { num, sel, fin } from './opkit.js';

const C = { bot:'#6fb08a' };
const pk = (i, idx, p, k) => (i[idx] == null ? p[k] : fin(i[idx]));
const merge = (c, o) => { if (c.out) c.out.$bot = { ...(c.out.$bot || {}), ...o }; return []; };

export const BOT_OPS = {

// ---------------------------------------------------------------- the tree
// Thickness goes as the SQUARE ROOT of the files in a subtree — da Vinci's
// rule, where the children's cross-sections sum to the parent's. Using the
// count directly gives a trunk like a wall.
'bot.tree': { cat:'bot', title:'Tree shape', color:C.bot, w:226,
  ins:[{k:'angle',label:'spread'},{k:'len',label:'length'},{k:'photo',label:'upward'},
       {k:'twist',label:'twist'}],
  outs:[],
  params:[ num('angle','spread deg',95,0,200,0.5),
           num('lenBase','first length',0.21,0.02,0.6,0.005),
           num('lenFall','length falloff',0.84,0.3,1.2,0.005),
           num('thick','thickness',1.9,0.1,12,0.05),
           num('photo','upward bias',0.12,-0.5,1,0.005),
           num('twist','twist per level',0,-60,60,0.2),
           num('maxDepth','max depth',5,1,8,1) ],
  init:()=>({}),
  eval:(p,i,s,c)=>merge(c,{ angle:pk(i,0,p,'angle'), lenBase:pk(i,1,p,'lenBase'),
    lenFall:p.lenFall, thick:p.thick, photo:pk(i,2,p,'photo'),
    twist:pk(i,3,p,'twist'), maxDepth:p.maxDepth }) },

// ---------------------------------------------------------------- growth
// 0 is a bare root, 1 is the whole tree. Levels appear in order and the
// frontier extends partway, so driving this from a channel makes the tree
// grow and recede rather than blink between states.
'bot.grow': { cat:'bot', title:'Growth', color:C.bot, w:214,
  ins:[{k:'g',label:'amount'}], outs:[],
  params:[ num('grow','amount',1,0,1,0.005),
           num('labelDepth','label depth',2,0,6,1) ],
  init:()=>({}),
  eval:(p,i,s,c)=>merge(c,{ grow:pk(i,0,p,'grow'), labelDepth:p.labelDepth }) },

// ---------------------------------------------------------------- fruit
// Files. Radius follows sqrt(log(size)), so a 2 GB file is bigger than a
// 2 KB one without being a thousand times bigger. Petals above 2 turn each
// berry into a flower — which is the thing you actually asked for.
'bot.fruit': { cat:'bot', title:'Fruit / flowers', color:C.bot, w:226,
  ins:[{k:'size',label:'size'},{k:'bloom',label:'bloom'},{k:'petals',label:'petals'}],
  outs:[],
  params:[ num('fSize','size',3.2,0,20,0.05),
           num('fPetals','petals',5,0,12,1),
           num('fBloom','bloom',0.45,0,1.5,0.005),
           num('fSpread','cluster spread',16,0,120,0.5) ],
  init:()=>({}),
  eval:(p,i,s,c)=>merge(c,{ fSize:pk(i,0,p,'fSize'), fBloom:pk(i,1,p,'fBloom'),
    fPetals:pk(i,2,p,'fPetals'), fSpread:p.fSpread }) },

};

export const BOT_CATS = [ ['bot','Botanical'] ];
