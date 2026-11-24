// boot-psyche.js — the Psychedelic OS patcher.
//
// Same editor as the Computing Visualizer's patcher, same graph engine, same
// operator registry. What differs is the palette it shows, where it saves,
// and what it previews — so the two patchers cannot drift apart as the engine
// improves, and an operator built for one is available in the other.

import { boot } from '../m0-telemetry/patch/editor.js';
import { defaultPsyche } from './defaults.js';
import { kineticDemo, imageDemo, layoutDemo, botanicalDemo } from './demos.js';

boot({
  // Everything. This view now runs the full image chain as well as the
  // typography, so a patch here can reach the letters, the shapes, the scan
  // processor, the chemistry and the colouriser.
  // Pick first: the patcher reads "which elements, then what happens to
  // them", so the selector blocks lead.
  cats: ['read', 'pick',
         'text', 'layout', 'bot',
         'shape', 'xform', 'shapeop', 'render', 'color',
         'source', 'math', 'combine', 'filter', 'dsp', 'draw', 'rd',
         'logic', 'gen', 'util', 'out'],
  // No buses, no travellers, no hero's journey: those belong to the
  // Computing Visualizer and reach nothing here.
  destFilter: ['chain.', 'scan.', 'fb.', 'rd.'],
  patchUrl:   '/m1/patch',
  previewUrl: '/m1/view.html?compact=1',
  vizUrl:     '/m1/view.html',
  defaultGraph: defaultPsyche,
  demos: [
    { sel: '#demotype', fn: kineticDemo,
      note: 'letters bounce, scatter under pressure, and ride a drawn baseline' },
    { sel: '#demoimg', fn: imageDemo,
      note: 'load fades the whole image chain in over the crisp desktop' },
    { sel: '#demolay', fn: layoutDemo,
      note: 'icons gather into a ring, windows lean, pressure throws it apart' },
    { sel: '#demobot', fn: botanicalDemo,
      note: 'disk grows the tree, cpu opens the flowers — switch the view source to the tree' },
  ],
});
