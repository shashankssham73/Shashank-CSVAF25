// boot-telemetry.js — the Computing Visualizer's patcher.
//
// The editor itself is shared. This file says what THIS patcher is: which
// operator categories belong in its palette, where its patch lives, and what
// its preview window shows.

import { boot } from './editor.js';
import { defaultGraph, scanimateDemo, rdDemo } from './graph.js';

boot({
  cats: ['source', 'math', 'combine', 'filter', 'dsp', 'draw', 'rd',
         'logic', 'gen', 'shape', 'xform', 'shapeop', 'render', 'color',
         'util', 'out'],
  patchUrl:   '/patch',
  previewUrl: '/viz.html?compact=1',
  vizUrl:     '/viz.html',
  defaultGraph,
  demos: [
    { sel: '#demo',   fn: scanimateDemo, note: 'a Scanimate chain driven by cpu.busy_pct' },
    { sel: '#demord', fn: rdDemo,        note: 'load fades in Gray-Scott, i/o feeds it' },
  ],
});
