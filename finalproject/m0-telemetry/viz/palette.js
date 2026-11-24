// Palette — isolated on purpose. Every colour decision in the visualizer comes
// from this file, so a reference image can be matched by editing one place.
//
// Chosen treatment: near-black ground, two meaningful hues.
//   cyan  = the ordinary path, work proceeding
//   amber = contention, retry, pressure, failure
// Colour is never decorative here. If something is amber, something is wrong.

export const P = {
  // ground
  bg:          '#04070d',
  vignette:    'rgba(0,0,0,0.55)',

  // static structure (drawn crisp, above the feedback field)
  busIdle:     'rgba(28, 70, 92, 0.40)',
  busLive:     'rgba(53, 224, 255, 0.22)',
  nodeFill:    'rgba(6, 18, 28, 0.82)',
  nodeStroke:  'rgba(32, 96, 122, 0.95)',
  nodeStrokeHot:'rgba(53, 224, 255, 0.95)',
  nodeLabel:   'rgba(127, 212, 232, 0.90)',
  nodeSub:     'rgba(90, 150, 172, 0.55)',

  // unmeasurable without root — drawn, but visibly dead
  dead:        'rgba(22, 32, 42, 0.85)',
  deadLabel:   'rgba(58, 78, 92, 0.75)',

  // particles (additive, so these read brighter than they look)
  flow:        [53, 224, 255],
  flowDim:     [26, 122, 148],
  hero:        [190, 245, 255],
  warn:        [255, 160, 42],
  warnHot:     [255, 92, 26],

  // cpu occupancy ring
  ringTrack:   'rgba(20, 54, 70, 0.70)',
  ringUser:    'rgba(53, 224, 255, 0.95)',
  ringSys:     'rgba(255, 160, 42, 0.85)',

  // hud
  hudText:     'rgba(127, 212, 232, 0.92)',
  hudDim:      'rgba(80, 136, 158, 0.70)',
  hudWarn:     'rgba(255, 160, 42, 0.95)',
  hudBg:       'rgba(4, 10, 16, 0.72)',
  hudRule:     'rgba(32, 96, 122, 0.45)',
};

export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
